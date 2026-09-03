const OGG_CRC_POLYNOMIAL = 0x04c11db7;

const TABLE = new Uint32Array(256);
for (let value = 0; value < TABLE.length; value++) {
  let crc = value << 24;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 0x80000000 ? (crc << 1) ^ OGG_CRC_POLYNOMIAL : crc << 1;
  }
  TABLE[value] = crc >>> 0;
}

/** Calculate the CRC-32. */
export default function crc32(buffer: Buffer, seed = 0) {
  let crc = seed >>> 0;

  for (const byte of buffer) {
    crc = ((crc << 8) ^ TABLE[(crc >>> 24) ^ byte]!) >>> 0;
  }

  return crc;
}
