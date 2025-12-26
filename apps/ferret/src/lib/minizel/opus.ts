/** Get the number of frames in an Opus packet */
export function getFramesInPacket(packet: Uint8Array): number {
  const toc = packet[0]! & 0x3;
  switch (toc) {
    case 0:
      return 1;
    case 1:
    case 2:
      return 2;
    case 3: // Signalled
      return packet[1]! & 0x3f;
    default:
      return 1;
  }
}

/** Get the frame size (in samples) of an Opus packet */
export function getFrameSize(packet: Uint8Array): number {
  const config = packet[0]! >> 3;
  switch (config) {
    case 0:
    case 4:
    case 8:
    case 12:
    case 14:
    case 18:
    case 22:
    case 27:
    case 30:
      return 480; // 10ms
    case 2:
    case 6:
    case 10:
      return 1920; // 40ms
    case 3:
    case 7:
    case 11:
      return 2880; // 60ms
    case 17:
    case 21:
    case 25:
    case 29:
      return 240; // 5ms
    case 16:
    case 20:
    case 24:
    case 28:
      return 120; // 2.5ms
    default:
      return 960; // 20ms
  }
}
