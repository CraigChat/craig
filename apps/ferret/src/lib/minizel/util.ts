/** Silent OPUS frame (3 bytes) */
export const SILENT_OPUS = new Uint8Array([0xf8, 0xff, 0xfe]);

/** Default packet time in samples (20ms at 48kHz) */
export const DEFAULT_PACKET_TIME = 960n;

/** Silent FLAC frame at 48kHz */
export const SILENT_FLAC_48K = new Uint8Array([0xff, 0xf8, 0x7a, 0x0c, 0x00, 0x03, 0xbf, 0x94, 0x00, 0x00, 0x00, 0x00, 0xb1, 0xca]);

/** Silent FLAC frame at 44.1kHz */
export const SILENT_FLAC_44K = new Uint8Array([0xff, 0xf8, 0x79, 0x0c, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xc5]);

/** OPUS header magic bytes */
export const OPUS = new TextEncoder().encode('Opus');

/** FLAC header magic bytes */
export const FLAC = new TextEncoder().encode('\x7fFLAC');

/** OPUS tags header magic bytes */
export const OPUS_TAGS = new TextEncoder().encode('OpusTags');

/** Memory management constants - conservative for broader device support */
export const HIGH_WATERMARK = 30 * 1024 * 1024; // 30 MB
export const LOW_WATERMARK = 15 * 1024 * 1024; // 15 MB

/** Chunk size for file writes */
export const CHUNK_SIZE = 256 * 1024; // 256 KB

/** Max samples in-flight per track to prevent memory buildup */
export const MAX_PENDING_SAMPLES = 50;

/** Max seconds to buffer for mixing */
export const MIX_BUFFER_SECONDS = 3;

/** Standard sample rate */
export const SAMPLE_RATE = 48_000;

/** Mix step size in samples */
export const MIX_STEP = 960;

/**
 * Check if opus tags are missing the user comment list length
 * https://datatracker.ietf.org/doc/html/rfc7845#section-5.2
 */
export function opusTagsAreIncorrect(tags: Uint8Array): boolean {
  const view = new DataView(tags.buffer, tags.byteOffset, tags.byteLength);
  const vendorLength = view.getUint32(8, true);
  return tags.length <= 12 + vendorLength;
}

/** Compare two Uint8Arrays for equality */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Concatenate two Uint8Arrays */
export function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Format bytes as human readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formattedSize = (bytes / Math.pow(k, i)).toFixed(2);
  return `${formattedSize} ${units[i]}`;
}

/** Convert seconds to time mark string (HH:MM:SS.ss) */
export function convertToTimeMark(seconds: number, includeHours?: boolean): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = remainingSeconds.toString().padStart(2, '0');

  if (hours === 0 && !includeHours) {
    return `${formattedMinutes}:${formattedSeconds}`;
  }
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

export type MinizelFormat = 'ogg' | 'aac' | 'flac' | 'wav';
