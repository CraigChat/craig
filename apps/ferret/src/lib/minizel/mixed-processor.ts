import { newQueue } from '@henrygd/queue';
import { FLACDecoderWebWorker } from '@wasm-audio-decoders/flac';
import {
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  FlacOutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
  WavOutputFormat
} from 'mediabunny';
import { OpusDecoderWebWorker } from 'opus-decoder';

import type { PageMeta, WorkerMessage } from './oggParser.worker';
import {
  bytesEqual,
  CHUNK_SIZE,
  FLAC,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  type MinizelFormat,
  MIX_BUFFER_SECONDS,
  MIX_STEP,
  OPUS,
  SAMPLE_RATE
} from './util';

type MixFormat = Exclude<MinizelFormat, 'ogg'>;

type MixPacket = {
  left: Float32Array;
  right: Float32Array;
  granulePosition: number;
};

export interface MixedProcessorOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  fileHandle: FileSystemFileHandle;
  format: MixFormat;
  excludedTracks?: Set<number>;
  onProgress?: () => void;
}

/**
 * Resample audio buffer from one sample rate to another using linear interpolation
 */
function resampleAudioBuffer(channelData: Float32Array[], fromRate: number, toRate: number): Float32Array[] {
  if (fromRate === toRate) return channelData;
  const ratio = toRate / fromRate;
  const newLength = Math.round(channelData[0]!.length * ratio);
  return channelData.map((channel) => {
    const newChannel = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i / ratio;
      const srcIdxInt = Math.floor(srcIdx);
      const frac = srcIdx - srcIdxInt;
      if (srcIdxInt + 1 < channel.length) {
        newChannel[i] = (1 - frac) * channel[srcIdxInt]! + frac * channel[srcIdxInt + 1]!;
      } else {
        newChannel[i] = channel[srcIdxInt]!;
      }
    }
    return newChannel;
  });
}

export class MixedProcessor {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private format: MixFormat;
  private fileHandle: FileSystemFileHandle;
  private excludedTracks: Set<number>;
  private readerPaused = false;
  private readerPausedResolve: (() => void) | null = null;
  private _workerDone: (() => void) | null = null;
  private aborted = false;

  // Stream state
  private streamTypes = new Map<number, 'opus' | 'flac'>();
  private streamFlacRates = new Map<number, number>();
  private granuleOffset: bigint | null = null;
  private streamPositions = new Map<number, bigint>();

  // Stats
  outstandingNetworkBytes = 0;
  downloadedBytes = 0;
  bytesWritten = 0;
  currentMixPosition = 0;
  samplesWritten = 0;
  packetsDecoded = 0;
  pagesReceived = 0;

  // Decoders
  private opusDecoder: OpusDecoderWebWorker<48000> | null = null;
  private flacDecoder: FLACDecoderWebWorker | null = null;

  // MediaBunny output
  private mbOutput: Output | null = null;
  private mbSampleSource: AudioSampleSource | null = null;
  private queue = newQueue(1);
  private decodingQueue = newQueue(1);

  // Mix buffer - bounded to prevent unbounded growth
  private mixCache: MixPacket[] = [];
  private maxMixCacheSamples = SAMPLE_RATE * MIX_BUFFER_SECONDS;

  // Callbacks
  onProgress?: () => void;
  onFinish?: () => void;

  constructor(options: MixedProcessorOptions) {
    this.reader = options.reader;
    this.fileHandle = options.fileHandle;
    this.format = options.format;
    this.excludedTracks = options.excludedTracks ?? new Set();
    this.onProgress = options.onProgress;
  }

  /** Check if a track is excluded */
  isTrackExcluded(serial: number): boolean {
    return this.excludedTracks.has(serial);
  }

  /** Estimate queued bytes for backpressure (includes network buffer + decoded mix cache) */
  estimatedQueuedBytes(): number {
    // Calculate approximate size of mix cache (Float32Array = 4 bytes per sample, 2 channels)
    const mixCacheBytes = this.mixCache.reduce((sum, packet) => {
      return sum + packet.left.length * 4 + packet.right.length * 4;
    }, 0);
    return this.outstandingNetworkBytes + mixCacheBytes;
  }

  /** Abort processing */
  abort(): void {
    this.aborted = true;
    if (this.readerPausedResolve) {
      this.readerPausedResolve();
      this.readerPausedResolve = null;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.mbOutput?.cancel();
    } catch {}

    try {
      const writable = await this.fileHandle.createWritable();
      await writable.truncate(0);
      await writable.close();
    } catch {}
  }

  private checkResume(): void {
    if (this.readerPaused && this.estimatedQueuedBytes() <= LOW_WATERMARK) {
      this.readerPaused = false;
      if (this.readerPausedResolve) {
        const r = this.readerPausedResolve;
        this.readerPausedResolve = null;
        r();
      }
    }
  }

  private async ensureOutput(): Promise<void> {
    if (this.mbSampleSource) return;

    const output = new Output({
      format: this.format === 'aac' ? new AdtsOutputFormat() : this.format === 'flac' ? new FlacOutputFormat() : new WavOutputFormat({ large: true }),
      target: await this.createStreamTarget(await this.fileHandle.createWritable(), (pos, len) => {
        this.bytesWritten = Math.max(this.bytesWritten, pos + len);
      })
    });

    const audioSource = new AudioSampleSource({
      codec: this.format === 'wav' ? 'pcm-f32' : this.format,
      bitrate: QUALITY_HIGH
    });
    output.addAudioTrack(audioSource);
    await output.start();
    this.mbOutput = output;
    this.mbSampleSource = audioSource;
  }

  private async createStreamTarget(writer: FileSystemWritableFileStream, onWrite?: (pos: number, dataLength: number) => void): Promise<StreamTarget> {
    const writable = new WritableStream({
      async write(chunk: StreamTargetChunk) {
        await writer.write({ type: 'write', position: chunk.position, data: chunk.data as BufferSource });
        onWrite?.(chunk.position, chunk.data.byteLength);
      },
      close() {
        writer.close();
      },
      async abort() {
        await writer.abort();
      }
    });
    return new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE });
  }

  private async enqueueSample(left: Float32Array, right: Float32Array, startPosition: number): Promise<void> {
    const blockLength = left.length;
    this.samplesWritten++;
    this.queue.add(async () => {
      const planar = new Float32Array(blockLength * 2);
      planar.set(left, 0);
      planar.set(right, blockLength);

      const sample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: SAMPLE_RATE,
        timestamp: startPosition / SAMPLE_RATE
      });

      try {
        await this.mbSampleSource!.add(sample);
      } finally {
        sample.close();
      }
    });
  }

  private pruneMixCache(): void {
    // Remove packets that are too far behind current write position
    const cutoff = this.currentMixPosition - this.maxMixCacheSamples;
    this.mixCache = this.mixCache.filter((packet) => packet.granulePosition + packet.left.length > cutoff);
  }

  private async processMix(finalize = false): Promise<void> {
    while (true) {
      if (this.mixCache.length === 0) break;

      // Prune old packets
      this.pruneMixCache();
      if (this.mixCache.length === 0) break;

      const ordered = [...this.mixCache].sort((a, b) => a.granulePosition - b.granulePosition);
      const minStart = ordered[0]!.granulePosition;
      const maxStart = ordered[ordered.length - 1]!.granulePosition;
      const range = maxStart - minStart;

      const blockStart = this.currentMixPosition;
      const blockEnd = blockStart + MIX_STEP;

      // Calculate the latest end position of any packet
      const latestEnd = this.mixCache.reduce((max, packet) => {
        const packetEnd = packet.granulePosition + packet.left.length;
        return packetEnd > max ? packetEnd : max;
      }, 0);

      // Wait for more data if the mix cache is not full
      const shouldMix = range > SAMPLE_RATE * MIX_BUFFER_SECONDS;
      if (!finalize && !shouldMix) {
        const bufferAhead = latestEnd - blockStart;
        const minBufferSamples = SAMPLE_RATE * 0.5;
        if (bufferAhead < minBufferSamples) break;
      }

      // If data is ahead, fill with silence
      if (minStart >= blockEnd) {
        const gap = minStart - blockStart;
        const blocksToFill = finalize ? Math.ceil(gap / MIX_STEP) : Math.floor(gap / MIX_STEP);
        if (!finalize && blocksToFill === 0) break;

        for (let i = 0; i < blocksToFill; i++) {
          const zeroLeft = new Float32Array(MIX_STEP);
          const zeroRight = new Float32Array(MIX_STEP);
          await this.enqueueSample(zeroLeft, zeroRight, this.currentMixPosition);
          this.currentMixPosition += MIX_STEP;
        }
        continue;
      }

      // Mix all overlapping packets into this block
      const blockLeft = new Float32Array(MIX_STEP);
      const blockRight = new Float32Array(MIX_STEP);
      let audioAdded = false;

      for (const packet of this.mixCache) {
        const packetStart = packet.granulePosition;
        const packetEnd = packetStart + packet.left.length;

        if (packetEnd <= blockStart || packetStart >= blockEnd) continue;

        audioAdded = true;

        const overlapStart = Math.max(blockStart, packetStart);
        const overlapEnd = Math.min(blockEnd, packetEnd);
        const srcOffset = overlapStart - packetStart;
        const destOffset = overlapStart - blockStart;
        const overlapLength = overlapEnd - overlapStart;

        for (let i = 0; i < overlapLength; i++) {
          blockLeft[destOffset + i]! += packet.left[srcOffset + i]!;
          blockRight[destOffset + i]! += packet.right[srcOffset + i]!;
        }
      }

      // wait for more data if nothing mixed and we are fine
      if (!audioAdded && !finalize && !shouldMix) break;

      await this.enqueueSample(blockLeft, blockRight, blockStart);
      this.currentMixPosition += MIX_STEP;
      this.onProgress?.();
    }
  }

  private onWorkerMessage(msg: WorkerMessage): void {
    if (this.aborted) return;

    if (msg.type === 'page') {
      this.pagesReceived++;
      const pageBuf = new Uint8Array(msg.page);
      const meta: PageMeta = msg.meta;
      this.outstandingNetworkBytes = Math.max(0, this.outstandingNetworkBytes - meta.payloadLength);

      const serial = meta.serial;

      if (this.isTrackExcluded(serial)) {
        this.checkResume();
        return;
      }

      const pageSegments = pageBuf[26]!;
      const headerTotalLen = 27 + pageSegments;
      // Copy payload to avoid issues with transferred buffer
      const payload = pageBuf.slice(headerTotalLen);
      const granulePosition = BigInt(meta.granulePosition);

      // Determine stream type if header
      if (granulePosition === 0n) {
        if (payload.length < 5) return;
        if (bytesEqual(payload.subarray(0, 4), OPUS)) {
          this.streamTypes.set(serial, 'opus');
        } else if (bytesEqual(payload.subarray(0, 5), FLAC)) {
          this.streamTypes.set(serial, 'flac');
          if (payload.length > 29) {
            const flacRate = (payload[27]! << 12) + (payload[28]! << 4) + (payload[29]! >> 4);
            this.streamFlacRates.set(serial, flacRate);
          }
        }
        return;
      }

      if (!this.granuleOffset) this.granuleOffset = granulePosition;
      if (payload.length <= 1) return;

      const type = this.streamTypes.get(serial);
      if (!type) return;

      // Queue decoding (payload is already copied above)
      this.decodingQueue.add(async () => {
        if (this.aborted) return;

        const currentPosition = this.streamPositions.get(serial) ?? this.granuleOffset!;
        let chosenStartPosition = currentPosition;

        // Packet far behind: drop
        if (currentPosition > granulePosition + BigInt(960 * 25)) {
          console.debug(`[Minizel] Dropping packet: too far behind (current: ${currentPosition}, granule: ${granulePosition})`);
          return;
        }

        // Packet far ahead: set position
        if (currentPosition + 960n * 25n < granulePosition) chosenStartPosition = granulePosition;

        // Decode
        this.packetsDecoded++;
        const decoded = type === 'opus' ? await this.opusDecoder!.decodeFrame(payload) : await this.flacDecoder!.decode(payload);
        let channelData = decoded.channelData;

        // Resample if needed
        if (decoded.sampleRate !== SAMPLE_RATE) channelData = resampleAudioBuffer(channelData, decoded.sampleRate, SAMPLE_RATE);

        // Add to mix cache (bounded)
        const startPosition = Number(chosenStartPosition - this.granuleOffset!);
        this.mixCache.push({
          left: channelData[0]!,
          right: channelData[1]!,
          granulePosition: startPosition
        });
        this.streamPositions.set(serial, chosenStartPosition + BigInt(channelData[0]!.length));

        // Process mix
        await this.processMix();

        // Update progress after processing
        this.onProgress?.();

        // Check resume
        if (this.readerPaused && this.estimatedQueuedBytes() <= LOW_WATERMARK) {
          this.readerPaused = false;
          if (this.readerPausedResolve) {
            this.readerPausedResolve();
            this.readerPausedResolve = null;
          }
        }
      });
    } else if (msg.type === 'consumed') {
      this.outstandingNetworkBytes = Math.max(0, this.outstandingNetworkBytes - (msg.consumed ?? 0));
      this.checkResume();
    } else if (msg.type === 'error') {
      console.error('Mixed worker error', msg.message);
    } else if (msg.type === 'done') {
      this._workerDone?.();
    }
  }

  async start(): Promise<void> {
    this.opusDecoder = new OpusDecoderWebWorker({ forceStereo: true, sampleRate: 48_000 });
    this.flacDecoder = new FLACDecoderWebWorker();
    await Promise.all([this.opusDecoder.ready, this.flacDecoder.ready]);

    const canDo = await canEncodeAudio(this.format === 'wav' ? 'pcm-f32' : this.format, {
      numberOfChannels: 2,
      sampleRate: 48_000
    });
    if (!canDo) throw new Error(`Browser cannot encode ${this.format} audio`);

    await this.ensureOutput();

    const worker = new Worker(new URL('./oggParser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ogg-parser'
    });
    const waitForWorker = new Promise<void>((resolve) => (this._workerDone = resolve));
    worker.addEventListener('message', (ev: MessageEvent) => this.onWorkerMessage(ev.data));

    try {
      try {
        while (!this.aborted) {
          const { done, value } = await this.reader.read();
          if (done) {
            worker.postMessage({ type: 'end' });
            break;
          }
          if (!value) continue;

          this.outstandingNetworkBytes += value.byteLength;
          this.downloadedBytes += value.byteLength;
          worker.postMessage({ type: 'chunk', chunk: value.buffer }, [value.buffer]);
          this.onProgress?.();

          // Backpressure
          if (this.estimatedQueuedBytes() > HIGH_WATERMARK) {
            this.readerPaused = true;
            await new Promise<void>((resolve) => (this.readerPausedResolve = resolve));
          }
        }
      } finally {
        try {
          this.reader.releaseLock();
        } catch {}
      }

      if (!this.aborted) await waitForWorker;
      worker.terminate();

      console.debug(`[Minizel] Worker done. Pages: ${this.pagesReceived}, Streams: ${this.streamTypes.size}`);

      // Wait for decoding to finish
      await this.decodingQueue.done();

      console.debug(`[Minizel] Decoding done. Packets decoded: ${this.packetsDecoded}, Mix cache size: ${this.mixCache.length}`);

      await this.opusDecoder?.free();
      this.opusDecoder = null;
      await this.flacDecoder?.free();
      this.flacDecoder = null;

      // Process remaining packets
      const cacheBeforeFinalize = this.mixCache.length;
      await this.processMix(true);

      console.debug(`[Minizel] Final mix done. Cache before: ${cacheBeforeFinalize}, Samples written: ${this.samplesWritten}, Position: ${this.currentMixPosition}`);

      // Finalize output
      await this.queue.done();
      await this.mbOutput!.finalize();

      console.debug(`[Minizel] Output finalized. Bytes written: ${this.bytesWritten}`);

      // Final progress update
      this.onProgress?.();
      this.onFinish?.();
    } catch (e) {
      console.error('Mixed processor error!', e);
      worker.terminate();
      this.queue.clear();
      this.decodingQueue.clear();
      await this.mbOutput?.cancel();
      this.mbSampleSource?.close();
      await this.opusDecoder?.free();
      this.opusDecoder = null;
      await this.flacDecoder?.free();
      this.flacDecoder = null;
      throw e;
    }
  }
}
