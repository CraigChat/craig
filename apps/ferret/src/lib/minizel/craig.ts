import { getFramesInPacket, getFrameSize } from './opus';
import { bytesEqual, DEFAULT_PACKET_TIME, FLAC, OPUS } from './util';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const ECVADD_MAGIC = textEncoder.encode('ECVADD');
export const ECMETA_MAGIC = textEncoder.encode('ECMETA');
export const STREAMNOTE_MAGIC = textEncoder.encode('STREAMNOTE');
export const FLAC_TAGS_MAGIC = new Uint8Array([0x04, 0x00, 0x00, 0x41]);

const GAP_THRESHOLD_PACKETS = 25n;
const FLAC_PACKET_TIME = 960;
const CORRECTION_HORIZON = DEFAULT_PACKET_TIME * GAP_THRESHOLD_PACKETS;

export type CraigAudioType = 'opus' | 'flac';

export type ParsedCraigPayload =
  | {
      kind: 'audio-header';
      type: CraigAudioType;
      payload: Uint8Array;
      vadWrapped?: boolean;
      flacRate?: number;
    }
  | { kind: 'meta-header'; payload: Uint8Array }
  | { kind: 'note-header'; payload: Uint8Array }
  | { kind: 'unknown'; payload: Uint8Array };

export type CraigPageEvent =
  | {
      kind: 'audio-header';
      serial: number;
      type: CraigAudioType;
      payload: Uint8Array;
      headerType: number;
      pageSequenceNumber: number;
      flacRate?: number;
    }
  | { kind: 'meta'; serial: number; payload: Uint8Array }
  | { kind: 'note'; serial: number; payload: Uint8Array }
  | {
      kind: 'audio-packet';
      serial: number;
      type: CraigAudioType;
      payload: Uint8Array;
      inputGranulePosition: bigint;
      pageSequenceNumber: number;
      framesInPacket: number;
      frameSize: number;
      flacRate: number;
    };

export type CorrectedCraigPacket = {
  kind: 'packet' | 'silence';
  payload: Uint8Array;
  granulePosition: bigint;
  logicalGranulePosition: bigint;
  durationSamples: bigint;
};

type StreamInfo = {
  type?: CraigAudioType;
  flacRate?: number;
  vadWrapped?: boolean;
  meta?: boolean;
  note?: boolean;
};

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && bytesEqual(bytes.subarray(0, prefix.length), prefix);
}

function stripVadHeader(payload: Uint8Array): { payload: Uint8Array; vadWrapped?: boolean } {
  if (!startsWith(payload, ECVADD_MAGIC) || payload.length < 8) return { payload };

  const extraLength = payload[6]! | (payload[7]! << 8);
  const audioOffset = 8 + extraLength;
  if (audioOffset >= payload.length) return { payload };

  return {
    payload: payload.subarray(audioOffset),
    vadWrapped: true
  };
}

export function parseFlacSampleRate(payload: Uint8Array): number | undefined {
  if (payload.length <= 29) return undefined;
  return (payload[27]! << 12) + (payload[28]! << 4) + (payload[29]! >> 4);
}

export function parseCraigPayload(payload: Uint8Array, knownType?: CraigAudioType): ParsedCraigPayload {
  const stripped = stripVadHeader(payload);

  if (startsWith(stripped.payload, OPUS)) {
    return {
      kind: 'audio-header',
      type: 'opus',
      payload: stripped.payload,
      vadWrapped: stripped.vadWrapped
    };
  }

  if (startsWith(stripped.payload, FLAC)) {
    return {
      kind: 'audio-header',
      type: 'flac',
      payload: stripped.payload,
      vadWrapped: stripped.vadWrapped,
      flacRate: parseFlacSampleRate(stripped.payload)
    };
  }

  if (knownType === 'flac' && startsWith(stripped.payload, FLAC_TAGS_MAGIC)) {
    return {
      kind: 'audio-header',
      type: 'flac',
      payload: stripped.payload
    };
  }

  if (startsWith(payload, ECMETA_MAGIC)) return { kind: 'meta-header', payload };
  if (startsWith(payload, STREAMNOTE_MAGIC)) return { kind: 'note-header', payload };
  return { kind: 'unknown', payload };
}

export function stripVadPacket(payload: Uint8Array, vadWrapped = false): Uint8Array {
  if (!vadWrapped || payload.length === 0) return payload;
  return payload.subarray(1);
}

export function normalizeAudioToStereo(channelData: Float32Array[]): Float32Array[] {
  if (channelData.length === 0) return [new Float32Array(0), new Float32Array(0)];
  if (channelData.length === 1) return [channelData[0]!, channelData[0]!.slice()];
  return [channelData[0]!, channelData[1]!];
}

export function makePlanarF32(channelData: Float32Array[]): Float32Array {
  const frameCount = channelData[0]?.length ?? 0;
  const planar = new Float32Array(channelData.length * frameCount);
  for (let ch = 0; ch < channelData.length; ch++) {
    planar.set(channelData[ch]!, ch * frameCount);
  }
  return planar;
}

export class CraigOggState {
  private streams = new Map<number, StreamInfo>();
  private granuleOffset: bigint | null = null;
  private pauseTime: bigint | null = null;
  private pauseOffset = 0n;

  acceptPage(page: {
    serial: number;
    granulePosition: bigint;
    headerType: number;
    pageSequenceNumber: number;
    payload: Uint8Array;
  }): CraigPageEvent | undefined {
    const stream = this.streams.get(page.serial);

    if (page.granulePosition === 0n) {
      const parsed = parseCraigPayload(page.payload, stream?.type);

      if (parsed.kind === 'meta-header') {
        this.streams.set(page.serial, { meta: true });
        return { kind: 'meta', serial: page.serial, payload: parsed.payload };
      }

      if (parsed.kind === 'note-header') {
        this.streams.set(page.serial, { note: true });
        return { kind: 'note', serial: page.serial, payload: parsed.payload };
      }

      if (parsed.kind === 'audio-header') {
        this.streams.set(page.serial, {
          type: parsed.type,
          flacRate: parsed.flacRate ?? stream?.flacRate,
          vadWrapped: parsed.vadWrapped ?? stream?.vadWrapped
        });
        return {
          kind: 'audio-header',
          serial: page.serial,
          type: parsed.type,
          payload: parsed.payload,
          headerType: page.headerType,
          pageSequenceNumber: page.pageSequenceNumber,
          flacRate: parsed.flacRate
        };
      }

      return undefined;
    }

    if (stream?.meta) {
      this.acceptMetaPage(page.granulePosition, page.payload);
      return { kind: 'meta', serial: page.serial, payload: page.payload };
    }

    if (stream?.note) return { kind: 'note', serial: page.serial, payload: page.payload };
    if (!stream?.type) return undefined;

    if (this.granuleOffset === null) this.granuleOffset = page.granulePosition;

    const payload = stripVadPacket(page.payload, stream.vadWrapped);
    if (payload.length <= 0) return undefined;

    const inputGranulePosition = page.granulePosition - this.granuleOffset - this.pauseOffset;
    const normalizedGranulePosition = inputGranulePosition < 0n ? 0n : inputGranulePosition;
    const framesInPacket = stream.type === 'opus' ? getFramesInPacket(payload) : 1;
    const frameSize = stream.type === 'opus' ? getFrameSize(payload) : FLAC_PACKET_TIME;

    return {
      kind: 'audio-packet',
      serial: page.serial,
      type: stream.type,
      payload,
      inputGranulePosition: normalizedGranulePosition,
      pageSequenceNumber: page.pageSequenceNumber,
      framesInPacket,
      frameSize,
      flacRate: stream.flacRate ?? 48_000
    };
  }

  private acceptMetaPage(granulePosition: bigint, payload: Uint8Array): void {
    const text = textDecoder.decode(payload);
    if (text === '{"c":"pause"}') {
      this.pauseTime = granulePosition;
      return;
    }

    if (text === '{"c":"resume"}' && this.pauseTime !== null) {
      this.pauseOffset += granulePosition - this.pauseTime;
      this.pauseTime = null;
    }
  }
}

export class CraigTrackCorrector {
  private type: CraigAudioType;
  private flacRate: number;
  private logicalPosition: bigint | null = null;
  private newestPosition: bigint | null = null;
  private pending: Array<{
    granulePosition: bigint;
    payload: Uint8Array;
    framesInPacket: number;
    frameSize: number;
  }> = [];
  private receivedPacket = false;
  private finished = false;

  constructor(options: { type: CraigAudioType; flacRate?: number }) {
    this.type = options.type;
    this.flacRate = options.flacRate ?? 48_000;
  }

  get position(): bigint {
    return this.logicalPosition ?? 0n;
  }

  get outputPosition(): bigint {
    return this.toOutputGranule(this.position);
  }

  acceptPacket(packet: {
    granulePosition: bigint;
    payload: Uint8Array;
    framesInPacket: number;
    frameSize: number;
  }): CorrectedCraigPacket[] {
    if (this.finished) return [];
    this.receivedPacket = true;

    // Remain streamable: correct up to 500 ms of packet ordering
    const flushBefore = this.newestPosition === null ? null : this.newestPosition - CORRECTION_HORIZON;
    if (flushBefore !== null && packet.granulePosition <= flushBefore) return [];

    if (this.newestPosition === null || packet.granulePosition > this.newestPosition) this.newestPosition = packet.granulePosition;
    this.pending.push(packet);

    const boundary = this.newestPosition - CORRECTION_HORIZON;
    return this.drainPackets((candidate) => candidate.granulePosition <= boundary);
  }

  finish(): CorrectedCraigPacket[] {
    if (this.finished) return [];
    this.finished = true;
    if (!this.receivedPacket) return [this.makeOutput('silence', new Uint8Array(0), 0n, DEFAULT_PACKET_TIME)];
    return this.drainPackets(() => true);
  }

  private drainPackets(ready: (packet: { granulePosition: bigint }) => boolean): CorrectedCraigPacket[] {
    this.pending.sort((a, b) => (a.granulePosition < b.granulePosition ? -1 : a.granulePosition > b.granulePosition ? 1 : 0));
    const outputs: CorrectedCraigPacket[] = [];
    while (this.pending.length > 0 && ready(this.pending[0]!)) {
      outputs.push(...this.emitPacket(this.pending.shift()!));
    }
    return outputs;
  }

  private emitPacket(packet: {
    granulePosition: bigint;
    payload: Uint8Array;
    framesInPacket: number;
    frameSize: number;
  }): CorrectedCraigPacket[] {
    const firstPacket = this.logicalPosition === null;
    let logicalPosition = this.logicalPosition ?? 0n;

    const durationSamples = BigInt(packet.framesInPacket * packet.frameSize);
    const dropThreshold = BigInt(packet.frameSize) * GAP_THRESHOLD_PACKETS;
    if (!firstPacket && logicalPosition > packet.granulePosition + dropThreshold) return [];

    const outputs: CorrectedCraigPacket[] = [];
    if (firstPacket || logicalPosition + DEFAULT_PACKET_TIME * GAP_THRESHOLD_PACKETS < packet.granulePosition) {
      while (logicalPosition + DEFAULT_PACKET_TIME <= packet.granulePosition) {
        outputs.push(this.makeOutput('silence', packet.payload, logicalPosition, DEFAULT_PACKET_TIME));
        logicalPosition += DEFAULT_PACKET_TIME;
      }
    }

    outputs.push(this.makeOutput('packet', packet.payload, logicalPosition, durationSamples));
    this.logicalPosition = logicalPosition + durationSamples;
    return outputs;
  }

  private makeOutput(kind: 'packet' | 'silence', payload: Uint8Array, logicalPosition: bigint, durationSamples: bigint): CorrectedCraigPacket {
    return {
      kind,
      payload,
      logicalGranulePosition: logicalPosition,
      granulePosition: this.toOutputGranule(logicalPosition),
      durationSamples
    };
  }

  private toOutputGranule(position: bigint): bigint {
    if (this.type === 'flac' && this.flacRate === 44_100) return (position * 147n) / 160n;
    return position;
  }
}
