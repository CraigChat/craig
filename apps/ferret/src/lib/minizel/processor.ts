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

import { CraigOggState, type CraigAudioType, type CorrectedCraigPacket, CraigTrackCorrector, makePlanarF32, normalizeAudioToStereo } from './craig';
import { createPage } from './ogg';
import type { PageMeta, WorkerMessage } from './oggParser.worker';
import {
  bytesEqual,
  CHUNK_SIZE,
  concatUint8Arrays,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  MAX_PENDING_SAMPLES,
  type MinizelFormat,
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
  sampleRate: number;
  positionSeconds: number;
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
    if (this.pending <= 0) return;
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
  private workerError: Error | null = null;
  private aborted = false;

  // File system
  private directoryHandle: FileSystemDirectoryHandle;
  private writers = new Map<number, FileSystemWritableFileStream>();
  private writerCache = new Map<number, Uint8Array[]>();

  // Stream state
  private streamTypes = new Map<number, 'opus' | 'flac'>();
  private streamFlacRates = new Map<number, number>();
  private craigState = new CraigOggState();
  private correctors = new Map<number, CraigTrackCorrector>();
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
    for (const [serial, type] of this.streamTypes) {
      const sampleRate = type === 'flac' ? (this.streamFlacRates.get(serial) ?? 48_000) : 48_000;
      const position = Number(this.positions.get(serial) ?? 0n);
      stats.push({
        serial,
        type,
        bytesWritten: this.bytesWritten.get(serial) ?? 0,
        queuedBytes: this.queuedBytes.get(serial) ?? 0,
        queueSize: this.boundedQueues.get(serial)?.size ?? 0,
        position,
        sampleRate,
        positionSeconds: position / sampleRate
      });
    }
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
          sampleRate = flacRate;
        } else {
          // Decode frame
          const type = this.streamTypes.get(serial)!;
          const decoded = type === 'opus' ? await this.opusDecoder!.decodeFrame(frameCopy) : await this.flacDecoder!.decode(frameCopy);
          channelData = decoded.channelData;
          sampleRate = decoded.sampleRate;
        }

        channelData = normalizeAudioToStereo(channelData);
        const planarData = makePlanarF32(channelData);

        const sample = new AudioSample({
          data: planarData,
          format: 'f32-planar',
          numberOfChannels: 2,
          sampleRate,
          timestamp: Number(position) / sampleRate
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
    this.queuedBytes.set(serial, (this.queuedBytes.get(serial) ?? 0) + chunk.byteLength);
    q.add(async () => {
      let movedToCache = false;
      try {
        await this.ensureWriter(serial);
        const cache = this.writerCache.get(serial) ?? [];
        cache.push(chunk);
        this.writerCache.set(serial, cache);
        movedToCache = true;
        this.queuedBytes.set(serial, Math.max(0, (this.queuedBytes.get(serial) ?? 0) - chunk.byteLength));

        // Flush if over the chunk size
        const byteLength = cache.reduce((p, data) => p + data.length, 0);
        if (byteLength > CHUNK_SIZE) {
          await this.flushWriterCache(serial);
        }
      } finally {
        if (!movedToCache) this.queuedBytes.set(serial, Math.max(0, (this.queuedBytes.get(serial) ?? 0) - chunk.byteLength));
        this.checkResume();
        this.onProgress?.();
      }
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

  private writeCorrectedPackets(serial: number, type: CraigAudioType, flacRate: number, outputs: CorrectedCraigPacket[]): void {
    for (const output of outputs) {
      const payload =
        output.kind === 'silence' ? (type === 'opus' ? SILENT_OPUS : flacRate === 44_100 ? SILENT_FLAC_44K : SILENT_FLAC_48K) : output.payload;

      if (this.format === 'ogg') {
        this.writePage(
          serial,
          createPage({
            version: 0,
            headerType: 0,
            granulePosition: output.granulePosition,
            bitstreamSerialNumber: serial,
            pageSequenceNumber: this.getNextSequenceNumber(serial),
            payload
          })
        );
      } else {
        this.writePacket(serial, output.granulePosition, output.kind === 'silence' ? undefined : payload);
      }
    }
  }

  private failWorker(message: string): void {
    if (this.workerError) return;
    this.workerError = new Error(`Ogg parser worker failed: ${message}`);
    this._workerDone?.();
    this.reader.cancel(this.workerError).catch(() => {});
    this.readerPausedResolve?.();
    this.readerPausedResolve = null;
  }

  private async finalizeOutputs(): Promise<void> {
    await Promise.all(
      Array.from(this.queues.entries()).map(async ([serial, queue]) => {
        await queue.done();
        if (this.format === 'ogg') {
          await this.flushWriterCache(serial);
          await this.writers.get(serial)?.close();
          return;
        }

        this.mbSampleSources.get(serial)?.close();
        await this.mbOutputs.get(serial)?.finalize();
      })
    );
  }

  private onWorkerMessage(msg: WorkerMessage): void {
    if (this.aborted) return;

    if (msg.type === 'page') {
      const pageBuf = new Uint8Array(msg.page);
      const meta: PageMeta = msg.meta;
      const serial = meta.serial;

      const pageSegments = pageBuf[26]!;
      const headerTotalLen = 27 + pageSegments;
      // Copy payload to avoid issues with transferred buffer
      const payload = pageBuf.slice(headerTotalLen);
      const granulePosition = BigInt(meta.granulePosition);
      const event = this.craigState.acceptPage({
        serial,
        granulePosition,
        headerType: meta.headerType,
        pageSequenceNumber: meta.pageSequenceNumber,
        payload
      });
      if (!event) return;

      if (event.kind === 'meta' || event.kind === 'note') {
        this.checkResume();
        return;
      }

      if (event.kind === 'audio-header') {
        const wasKnown = this.streamTypes.has(serial);
        this.streamTypes.set(serial, event.type);
        if (event.flacRate) this.streamFlacRates.set(serial, event.flacRate);
        if (!wasKnown) this.onTrackDiscovered?.(serial, event.type);

        if (!this.isTrackExcluded(serial)) {
          if (!this.correctors.has(serial)) {
            this.correctors.set(serial, new CraigTrackCorrector({ type: event.type, flacRate: event.flacRate }));
          }
        }

        if (this.format === 'ogg' && !this.isTrackExcluded(serial)) {
          const outPayload =
            event.type === 'opus' && bytesEqual(event.payload.subarray(0, 8), OPUS_TAGS) && opusTagsAreIncorrect(event.payload)
              ? concatUint8Arrays(event.payload, new Uint8Array([0, 0, 0, 0]))
              : event.payload;
          this.writePage(
            serial,
            createPage({
              version: 0,
              headerType: event.headerType,
              granulePosition: 0n,
              bitstreamSerialNumber: serial,
              pageSequenceNumber: event.pageSequenceNumber,
              payload: outPayload
            })
          );
          this.lastSequenceNo.set(serial, event.pageSequenceNumber);
        }
        return;
      }

      if (this.isTrackExcluded(serial)) {
        this.checkResume();
        return;
      }

      const corrector = this.correctors.get(serial) ?? new CraigTrackCorrector({ type: event.type, flacRate: event.flacRate });
      this.correctors.set(serial, corrector);

      const outputs = corrector.acceptPacket({
        granulePosition: event.inputGranulePosition,
        payload: event.payload,
        framesInPacket: event.framesInPacket,
        frameSize: event.frameSize
      });
      this.writeCorrectedPackets(serial, event.type, event.flacRate, outputs);

      this.positions.set(serial, corrector.outputPosition);

      // Check backpressure
      const totalQueued = this.totalQueuedBytes();
      if (this.readerPaused && totalQueued <= LOW_WATERMARK) {
        this.readerPaused = false;
        if (this.readerPausedResolve) {
          const resolve = this.readerPausedResolve;
          this.readerPausedResolve = null;
          resolve();
        }
      }
    } else if (msg.type === 'consumed') {
      this.outstandingNetworkBytes = Math.max(0, this.outstandingNetworkBytes - (msg.consumed ?? 0));
      this.checkResume();
    } else if (msg.type === 'error') this.failWorker(msg.message);
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
            if (this.workerError) throw this.workerError;
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

      if (!this.aborted) {
        await waitForWorker;
        if (this.workerError) throw this.workerError;
      }
      worker.terminate();

      console.debug(`[Minizel] Worker done. Streams discovered: ${this.streamTypes.size}, Downloaded: ${this.downloadedBytes} bytes`);

      for (const [serial, corrector] of this.correctors) {
        const type = this.streamTypes.get(serial)!;
        const flacRate = this.streamFlacRates.get(serial) ?? 48_000;
        this.writeCorrectedPackets(serial, type, flacRate, corrector.finish());
        this.positions.set(serial, corrector.outputPosition);
      }

      await this.finalizeOutputs();

      console.debug(
        `[Minizel] Finalized. Tracks: ${this.streamTypes.size}, Total bytes written: ${Array.from(this.bytesWritten.values()).reduce((a, b) => a + b, 0)}`
      );

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
      await Promise.all(
        Array.from(this.writers.values()).map(async (writer) => {
          try {
            await writer.abort();
          } catch {}
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
