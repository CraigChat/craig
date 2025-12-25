/** OGG capture pattern 'OggS' as little-endian uint32 */
export const OGGS = 0x5367674f;

export const MIN_PAGE_HEADER_SIZE = 27;
export const MAX_PAGE_HEADER_SIZE = 27 + 255;
export const MAX_PAGE_SIZE = MAX_PAGE_HEADER_SIZE + 255 * 255;

/** CRC polynomial for OGG */
const OGG_CRC_POLYNOMIAL = 0x04c11db7;

/** Pre-computed CRC lookup table */
export const OGG_CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let crc = n << 24;
  for (let k = 0; k < 8; k++) {
    crc = crc & 0x80000000 ? (crc << 1) ^ OGG_CRC_POLYNOMIAL : crc << 1;
  }
  OGG_CRC_TABLE[n] = (crc >>> 0) & 0xffffffff;
}

/** Compute CRC32 checksum for an OGG page */
export function computeOggPageCrc(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  const originalChecksum = view.getUint32(22, true);
  view.setUint32(22, 0, true); // Zero out checksum field

  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    crc = ((crc << 8) ^ OGG_CRC_TABLE[(crc >>> 24) ^ byte]!) >>> 0;
  }

  view.setUint32(22, originalChecksum, true); // Restore checksum field
  return crc;
}

export interface OggPageData {
  version: number;
  headerType: number;
  granulePosition: bigint;
  bitstreamSerialNumber: number;
  pageSequenceNumber: number;
  payload: Uint8Array;
}

/** Create a valid OGG page with proper CRC */
export function createPage(data: OggPageData): Uint8Array {
  // Build the segment table
  const segments: number[] = [];
  let rem = data.payload.length;
  while (rem > 0) {
    const take = Math.min(255, rem);
    segments.push(take);
    rem -= take;
  }
  if (segments.length === 0) segments.push(0);

  const headerTotalLen = 27 + segments.length;
  const pageTotalLen = headerTotalLen + data.payload.length;

  // Allocate buffer for page
  const bytes = new Uint8Array(pageTotalLen);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, OGGS, true); // Capture pattern
  view.setUint8(4, data.version); // Version
  view.setUint8(5, data.headerType); // Header type
  view.setBigUint64(6, data.granulePosition, true); // Granule position
  view.setUint32(14, data.bitstreamSerialNumber, true); // Serial number
  view.setUint32(18, data.pageSequenceNumber, true); // Page sequence number
  view.setUint32(22, 0, true); // Checksum placeholder

  bytes[26] = segments.length; // Number of page segments
  bytes.set(segments, 27);
  bytes.set(data.payload, 27 + segments.length);

  // Compute CRC and write it
  const crc = computeOggPageCrc(bytes);
  view.setUint32(22, crc, true);

  return bytes;
}
