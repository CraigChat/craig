import { newQueue, type Queue } from '@henrygd/queue';
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

import { createPage } from './ogg';
import type { PageMeta, WorkerMessage } from './oggParser.worker';
import { getFramesInPacket, getFrameSize } from './opus';
import {
  bytesEqual,
  CHUNK_SIZE,
  concatUint8Arrays,
  DEFAULT_PACKET_TIME,
  FLAC,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  MAX_PENDING_SAMPLES,
  type MinizelFormat,
  OPUS,
  OPUS_TAGS,
  opusTagsAreIncorrect,
  SILENT_FLAC_44K,
  SILENT_FLAC_48K,
  SILENT_OPUS
} from './util';

export interface MinizelProcessorOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  directoryHandle: FileSystemDirectoryHandle;
  format: MinizelFormat;
  excludedTracks?: Set<number>;
  onFileName?: (serial: number) => string;
  onTrackDiscovered?: (serial: number, type: 'opus' | 'flac') => void;
  onProgress?: () => void;
}

export interface TrackStats {
  serial: number;
  type: 'opus' | 'flac';
  bytesWritten: number;
  queuedBytes: number;
  queueSize: number;
  position: number; // in samples
}

/**
 * Bounded queue to limit samples in-flight per track
 */
class BoundedQueue {
  private pending = 0;
  private waiters: (() => void)[] = [];

  constructor(private maxPending: number = MAX_PENDING_SAMPLES) {}

  async acquire(): Promise<void> {
    while (this.pending >= this.maxPending) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.pending++;
  }

  release(): void {
    this.pending--;
    this.waiters.shift()?.();
  }

  get size(): number {
    return this.pending;
  }
}

export class MinizelProcessor {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private format: MinizelFormat;
  private excludedTracks: Set<number>;
  private readerPaused = false;
  private readerPausedResolve: (() => void) | null = null;
  private _workerDone: (() => void) | null = null;
  private aborted = false;

  // File system
  private directoryHandle: FileSystemDirectoryHandle;
  private writers = new Map<number, FileSystemWritableFileStream>();
  private writerCache = new Map<number, Uint8Array[]>();

  // Stream state
  private streamTypes = new Map<number, 'opus' | 'flac'>();
  private streamFlacRates = new Map<number, number>();
  private granuleOffset: bigint | null = null;
  private positions = new Map<number, bigint>();
  private lastSequenceNo = new Map<number, number>();

  // Stats
  outstandingNetworkBytes = 0;
  downloadedBytes = 0;
  bytesWritten = new Map<number, number>();
  private queuedBytes = new Map<number, number>();

  // Decoders
  private opusDecoder: OpusDecoderWebWorker<48000> | null = null;
  private flacDecoder: FLACDecoderWebWorker | null = null;
  private silentAudioBuffer: Float32Array[] | null = null;
  private silentAudioBuffer44k: Float32Array[] | null = null;

  // MediaBunny outputs
  private mbOutputs = new Map<number, Output>();
  private mbSampleSources = new Map<number, AudioSampleSource>();
  private queues = new Map<number, Queue>();
  private boundedQueues = new Map<number, BoundedQueue>();

  // Callbacks
  onFileName?: (serial: number) => string;
  onTrackDiscovered?: (serial: number, type: 'opus' | 'flac') => void;
  onProgress?: () => void;

  constructor(options: MinizelProcessorOptions) {
    this.reader = options.reader;
    this.directoryHandle = options.directoryHandle;
    this.format = options.format;
    this.excludedTracks = options.excludedTracks ?? new Set();
    this.onFileName = options.onFileName;
    this.onTrackDiscovered = options.onTrackDiscovered;
    this.onProgress = options.onProgress;
  }

  /** Check if a track is excluded */
  isTrackExcluded(serial: number): boolean {
    return this.excludedTracks.has(serial);
  }

  /** Get total bytes queued in memory */
  totalQueuedBytes(): number {
    let t = this.outstandingNetworkBytes;
    for (const c of this.writerCache.values()) {
      t += c.reduce((p, data) => p + data.byteLength, 0);
    }
    for (const b of this.queuedBytes.values()) {
      t += b;
    }
    return t;
  }

  /** Get stats for all tracks */
  getTrackStats(): TrackStats[] {
    const stats: TrackStats[] = [];
    for (const [serial, type] of this.streamTypes)
      stats.push({
        serial,
        type,
        bytesWritten: this.bytesWritten.get(serial) ?? 0,
        queuedBytes: this.queuedBytes.get(serial) ?? 0,
        queueSize: this.boundedQueues.get(serial)?.size ?? 0,
        position: Number(this.positions.get(serial) ?? 0n)
      });
    return stats.sort((a, b) => a.serial - b.serial);
  }

  /** Abort processing and clean up created files */
  abort(): void {
    this.aborted = true;
    if (this.readerPausedResolve) {
      this.readerPausedResolve();
      this.readerPausedResolve = null;
    }
  }

  async cleanup(): Promise<void> {
    for (const writer of this.writers.values()) {
      try {
        await writer.close();
      } catch {}
    }

    for (const serial of this.writers.keys()) {
      const fileName = this.onFileName?.(serial) ?? `track-${serial}.${this.format}`;
      try {
        await this.directoryHandle.removeEntry(fileName);
      } catch {}
    }
  }

  private getNextSequenceNumber(streamNo: number): number {
    if (!this.lastSequenceNo.has(streamNo)) {
      this.lastSequenceNo.set(streamNo, 0);
      return 0;
    }
    const next = (this.lastSequenceNo.get(streamNo) ?? 0) + 1;
    this.lastSequenceNo.set(streamNo, next);
    return next;
  }

  private checkResume(): void {
    const totalQueued = this.totalQueuedBytes();
    if (this.readerPaused && totalQueued <= LOW_WATERMARK) {
      this.readerPaused = false;
      if (this.readerPausedResolve) {
        const r = this.readerPausedResolve;
        this.readerPausedResolve = null;
        r();
      }
    }
  }

  private async fileHandleToStreamTarget(handle: FileSystemFileHandle, onWrite?: (pos: number, dataLength: number) => void): Promise<StreamTarget> {
    const writer = await handle.createWritable();
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

  private writePacket(serial: number, position: bigint, frame?: Uint8Array): void {
    if (!this.queues.has(serial)) {
      this.queues.set(serial, newQueue(1));
      this.boundedQueues.set(serial, new BoundedQueue());
    }

    const q = this.queues.get(serial)!;
    const bounded = this.boundedQueues.get(serial)!;

    // Copy the frame if provided since it references a transferred buffer
    const frameCopy = frame ? frame.slice() : undefined;

    if (frameCopy) {
      this.queuedBytes.set(serial, (this.queuedBytes.get(serial) ?? 0) + frameCopy.byteLength);
    }

    q.add(async () => {
      // Acquire bounded slot inside the queue task
      await bounded.acquire();
      try {
        await this.ensureWriter(serial);
        const source = this.mbSampleSources.get(serial);
        if (!source) return;

        let channelData: Float32Array[];
        let sampleRate: number;

        if (!frameCopy) {
          // Silent frame
          const flacRate = this.streamFlacRates.get(serial) ?? 48000;
          channelData = flacRate === 44100 ? this.silentAudioBuffer44k! : this.silentAudioBuffer!;
          sampleRate = 48000;
        } else {
          // Decode frame
          const type = this.streamTypes.get(serial)!;
          const decoded = type === 'opus' ? await this.opusDecoder!.decodeFrame(frameCopy) : await this.flacDecoder!.decode(frameCopy);
          channelData = decoded.channelData;
          sampleRate = decoded.sampleRate;
        }

        // Create sample with proper format - combine channels into planar format
        const numChannels = channelData.length;
        const frameCount = channelData[0]!.length;
        const planarData = new Float32Array(numChannels * frameCount);
        for (let ch = 0; ch < numChannels; ch++) {
          planarData.set(channelData[ch]!, ch * frameCount);
        }

        const sample = new AudioSample({
          data: planarData,
          format: 'f32-planar',
          numberOfChannels: numChannels,
          sampleRate,
          timestamp: Number(position) / 48000
        });

        try {
          await source.add(sample);
        } finally {
          // CRITICAL: Always close sample to free memory
          sample.close();
        }
      } finally {
        if (frameCopy) {
          this.queuedBytes.set(serial, Math.max(0, (this.queuedBytes.get(serial) ?? 0) - frameCopy.byteLength));
        }
        bounded.release();
        this.checkResume();
        this.onProgress?.();
      }
    });
  }

  private writePage(serial: number, chunk: Uint8Array): void {
    if (!this.queues.has(serial)) {
      this.queues.set(serial, newQueue(1));
      this.boundedQueues.set(serial, new BoundedQueue());
    }

    const q = this.queues.get(serial)!;
    q.add(async () => {
      await this.ensureWriter(serial);
      const cache = this.writerCache.get(serial) ?? [];
      cache.push(chunk);
      this.writerCache.set(serial, cache);

      // Flush if over the chunk size
      const byteLength = cache.reduce((p, data) => p + data.length, 0);
      if (byteLength > CHUNK_SIZE) {
        await this.flushWriterCache(serial);
      }
      this.onProgress?.();
    });
  }

  private async flushWriterCache(serial: number): Promise<void> {
    const w = this.writers.get(serial);
    const cache = this.writerCache.get(serial);
    if (!w || !cache || cache.length <= 0) return;

    const byteLength = cache.reduce((p, data) => p + data.byteLength, 0);
    const data = new Uint8Array(byteLength);
    let offset = 0;
    for (const p of cache) {
      data.set(p, offset);
      offset += p.length;
    }
    await w.write(data);
    this.bytesWritten.set(serial, (this.bytesWritten.get(serial) ?? 0) + data.length);
    this.writerCache.delete(serial);
  }

  private async ensureWriter(serial: number): Promise<void> {
    // Fast path if already created
    if (this.writers.has(serial) || this.mbSampleSources.has(serial)) return;

    const fname = this.onFileName?.(serial) ?? `track-${serial}.${this.format}`;
    const fileHandle = await this.directoryHandle.getFileHandle(fname, { create: true });

    if (this.format === 'ogg') {
      const ws = await fileHandle.createWritable();
      this.writers.set(serial, ws);
      if (!this.lastSequenceNo.has(serial)) this.lastSequenceNo.set(serial, 0);
    } else {
      const output = new Output({
        format:
          this.format === 'aac' ? new AdtsOutputFormat() : this.format === 'flac' ? new FlacOutputFormat() : new WavOutputFormat({ large: true }),
        target: await this.fileHandleToStreamTarget(fileHandle, (pos, len) =>
          this.bytesWritten.set(serial, Math.max(this.bytesWritten.get(serial) ?? 0, pos + len))
        )
      });
      const audioSource = new AudioSampleSource({
        codec: this.format === 'wav' ? 'pcm-f32' : this.format,
        bitrate: QUALITY_HIGH
      });
      output.addAudioTrack(audioSource);
      this.mbOutputs.set(serial, output);
      this.mbSampleSources.set(serial, audioSource);
      await output.start();
    }
  }

  private onWorkerMessage(msg: WorkerMessage): void {
    if (this.aborted) return;

    if (msg.type === 'page') {
      const pageBuf = new Uint8Array(msg.page);
      const meta: PageMeta = msg.meta;
      this.outstandingNetworkBytes = Math.max(0, this.outstandingNetworkBytes - meta.payloadLength);

      const serial = meta.serial;

      // Skip excluded tracks entirely
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
          this.onTrackDiscovered?.(serial, 'opus');

          if (this.format === 'ogg') {
            if (bytesEqual(payload.subarray(0, 8), OPUS_TAGS) && opusTagsAreIncorrect(payload)) {
              // Fix opus tags
              this.writePage(
                serial,
                createPage({
                  version: 0,
                  headerType: meta.headerType,
                  granulePosition: 0n,
                  bitstreamSerialNumber: serial,
                  pageSequenceNumber: meta.pageSequenceNumber,
                  payload: concatUint8Arrays(payload, new Uint8Array([0, 0, 0, 0]))
                })
              );
            } else {
              // Rewrite page due to potential CRC mismatches
              this.writePage(
                serial,
                createPage({
                  version: 0,
                  headerType: meta.headerType,
                  granulePosition: 0n,
                  bitstreamSerialNumber: serial,
                  pageSequenceNumber: meta.pageSequenceNumber,
                  payload
                })
              );
            }
            this.lastSequenceNo.set(serial, meta.pageSequenceNumber);
          }
        } else if (bytesEqual(payload.subarray(0, 5), FLAC)) {
          this.streamTypes.set(serial, 'flac');
          this.onTrackDiscovered?.(serial, 'flac');

          if (payload.length > 29) {
            const flacRate = (payload[27]! << 12) + (payload[28]! << 4) + (payload[29]! >> 4);
            this.streamFlacRates.set(serial, flacRate);
          }
          if (this.format === 'ogg') {
            // Copy the entire page since pageBuf references transferred buffer
            this.writePage(serial, pageBuf.slice());
            this.lastSequenceNo.set(serial, meta.pageSequenceNumber);
          }
        }
        return;
      }

      if (!this.granuleOffset) this.granuleOffset = granulePosition;
      if (payload.length <= 1) return;

      const type = this.streamTypes.get(serial);
      if (!type) return;

      const frameCount = type === 'opus' ? getFramesInPacket(payload) : 1;
      const frameSize = type === 'opus' ? getFrameSize(payload) : 960;
      const packetSamples = BigInt(frameCount * frameSize);

      const flacRate = this.streamFlacRates.get(serial) ?? 48000;
      const convert = (p: bigint) => (flacRate === 44100 ? ((p - this.granuleOffset!) * 147n) / 160n : p - this.granuleOffset!);

      let currentPosition = this.positions.get(serial) ?? this.granuleOffset;

      // Packet far behind: drop
      if (currentPosition > granulePosition + BigInt(frameSize * 25)) return;

      // Packet far ahead: insert silence
      if (currentPosition + DEFAULT_PACKET_TIME * 25n < granulePosition) {
        const gap = granulePosition - currentPosition;
        const framesToInsert = Number(gap) / Number(DEFAULT_PACKET_TIME);

        for (let i = 0; i < Math.round(framesToInsert); i++) {
          const payloadSilent = type === 'opus' ? SILENT_OPUS : flacRate === 44100 ? SILENT_FLAC_44K : SILENT_FLAC_48K;
          const outPage = createPage({
            version: 0,
            headerType: 0,
            granulePosition: convert(currentPosition),
            bitstreamSerialNumber: serial,
            pageSequenceNumber: this.getNextSequenceNumber(serial),
            payload: payloadSilent
          });
          if (this.format === 'ogg') {
            this.writePage(serial, outPage);
          } else {
            this.writePacket(serial, convert(currentPosition));
          }
          currentPosition += DEFAULT_PACKET_TIME;
        }

        // Append the real packet after silence
        const dataOut = createPage({
          version: 0,
          headerType: 0,
          granulePosition: convert(currentPosition),
          bitstreamSerialNumber: serial,
          pageSequenceNumber: this.getNextSequenceNumber(serial),
          payload
        });
        if (this.format === 'ogg') this.writePage(serial, dataOut);
        else this.writePacket(serial, convert(currentPosition), payload);
        currentPosition += packetSamples;
        this.positions.set(serial, currentPosition);
      } else {
        // Normal append
        const outPage = createPage({
          version: 0,
          headerType: 0,
          granulePosition: convert(currentPosition),
          bitstreamSerialNumber: serial,
          pageSequenceNumber: this.getNextSequenceNumber(serial),
          payload
        });
        if (this.format === 'ogg') this.writePage(serial, outPage);
        else this.writePacket(serial, convert(currentPosition), payload);
        this.positions.set(serial, currentPosition + packetSamples);
      }

      // Check backpressure
      const totalQueued = this.totalQueuedBytes();
      if (this.readerPaused && totalQueued <= LOW_WATERMARK) {
        this.readerPaused = false;
        if (this.readerPausedResolve) {
          this.readerPausedResolve();
          this.readerPausedResolve = null;
        }
      }
    } else if (msg.type === 'consumed') {
      this.outstandingNetworkBytes = Math.max(0, this.outstandingNetworkBytes - (msg.consumed ?? 0));
      this.checkResume();
    } else if (msg.type === 'error') console.error('Worker error', msg.message);
    else if (msg.type === 'done') this._workerDone?.();
  }

  async start(): Promise<void> {
    if (this.format !== 'ogg') {
      this.opusDecoder = new OpusDecoderWebWorker({ forceStereo: true, sampleRate: 48_000 });
      this.flacDecoder = new FLACDecoderWebWorker();
      await Promise.all([this.opusDecoder.ready, this.flacDecoder.ready]);

      if (!this.silentAudioBuffer) {
        this.silentAudioBuffer = (await this.opusDecoder.decodeFrame(SILENT_OPUS)).channelData;
      }
      if (!this.silentAudioBuffer44k) {
        this.silentAudioBuffer44k = (await this.flacDecoder.decode(SILENT_FLAC_44K)).channelData;
      }

      const canDo = await canEncodeAudio(this.format === 'wav' ? 'pcm-f32' : this.format, {
        numberOfChannels: 2,
        sampleRate: 48_000
      });
      if (!canDo) throw new Error(`Browser cannot encode ${this.format} audio`);
    }

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
          const totalQueued = this.totalQueuedBytes();
          if (totalQueued > HIGH_WATERMARK) {
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

      console.debug(`[Minizel] Worker done. Streams discovered: ${this.streamTypes.size}, Downloaded: ${this.downloadedBytes} bytes`);

      if (this.format === 'ogg')
        await Promise.all(
          Array.from(this.writers.entries()).map(async ([serial, w]) => {
            await this.queues.get(serial)?.done();
            await this.flushWriterCache(serial);
            await w.close();
          })
        );
      else
        await Promise.all(
          Array.from(this.mbSampleSources.entries()).map(async ([serial]) => {
            await this.queues.get(serial)?.done();
            await this.mbOutputs.get(serial)!.finalize();
          })
        );

      console.debug(`[Minizel] Finalized. Tracks: ${this.streamTypes.size}, Total bytes written: ${Array.from(this.bytesWritten.values()).reduce((a, b) => a + b, 0)}`);

      // Check for empty output
      const totalWritten = Array.from(this.bytesWritten.values()).reduce((a, b) => a + b, 0);
      if (totalWritten === 0 && this.streamTypes.size === 0) {
        throw new Error('No audio tracks were found in the recording');
      }
    } catch (e) {
      console.error('Processor error!', e);
      worker.terminate();
      await Promise.all(
        Array.from(this.queues.entries()).map(async ([serial, q]) => {
          q.clear();
          await this.mbOutputs.get(serial)?.cancel();
          this.mbSampleSources.get(serial)?.close();
        })
      );
      throw e;
    } finally {
      await this.opusDecoder?.free();
      this.opusDecoder = null;
      await this.flacDecoder?.free();
      this.flacDecoder = null;
    }
  }
}
