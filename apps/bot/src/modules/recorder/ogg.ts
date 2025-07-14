import { WriteStream } from 'fs';

import crc32 from './crc32';

export const BOS = 2;
export const EOS = 4;

export default class OggEncoder {
  stream: WriteStream;

  constructor(stream: WriteStream) {
    this.stream = stream;
  }

  write(granulePos: number, streamNo: number, packetNo: number, chunk: Buffer, flags = 0) {
    // Calculate segment table
    const segmentCount = Math.ceil(chunk.length / 255) || 1;
    const headerBytes = 27 + segmentCount;
    const page = Buffer.alloc(headerBytes + chunk.length);

    // Byte 0: Initial header
    page.write('OggS', 0, 4, 'ascii');

    // Byte 4: Stream structure version (0)

    // Byte 5: Flags
    page.writeUInt8(flags, 5);

    // Byte 6: Granule pos
    page.writeBigUInt64LE(BigInt(granulePos), 6);

    // Byte 14: Stream number (4 bytes)
    page.writeUInt32LE(streamNo, 14);

    // Byte 18: Sequence number (4 bytes)
    page.writeUInt32LE(packetNo, 18);

    // Byte 22: CRC-32 (4 bytes)

    // Byte 26: Number of segments
    page.writeUInt8(segmentCount, 26);

    // Segment table (starts at 27)
    let remaining = chunk.length;
    let segIdx = 27;
    for (let i = 0; i < segmentCount; i++) {
      const segLen = remaining >= 255 ? 255 : remaining;
      page.writeUInt8(segLen, segIdx++);
      remaining -= segLen;
    }

    // Packet data
    chunk.copy(page, headerBytes);

    // Calculate CRC-32 (with CRC field zeroed)
    const crc = crc32(page);
    page.writeUInt32LE(crc, 22);

    // And write it out
    this.stream.write(page);
  }

  end() {
    this.stream.end();
  }
}
