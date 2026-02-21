import { OGGS } from './ogg';

type InMsg = { type: 'chunk'; chunk: ArrayBuffer } | { type: 'end' };

export type PageMeta = {
  serial: number;
  granulePosition: string; // bigint serialized as string
  pageSequenceNumber: number;
  headerType: number;
  payloadLength: number;
};

export type WorkerMessage =
  | { type: 'page'; page: ArrayBuffer; meta: PageMeta }
  | { type: 'consumed'; consumed: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

let buf = new Uint8Array(0);

function appendBuffer(ab: ArrayBuffer): void {
  const chunk = new Uint8Array(ab);
  if (buf.length === 0) {
    buf = chunk;
    return;
  }
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf, 0);
  out.set(chunk, buf.length);
  buf = out;
}

/**
 * Try to parse as many full OGG pages as possible from the buffer.
 * For each parsed page, post it back to main thread with transferable buffer.
 */
function processBuffer(): void {
  let pageView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let consumedTotal = 0;

  const notifyConsumed = (): void => {
    if (consumedTotal > 0) {
      try {
        self.postMessage({ type: 'consumed', consumed: consumedTotal });
      } catch {
        /* ignore */
      }
    }
  };

  while (true) {
    // Search for capture pattern 'OggS'
    let idx = -1;
    for (let i = 0; i + 3 < buf.length; i++) {
      if (pageView.getUint32(i, true) === OGGS) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      // Keep last 3 bytes in case 'OggS' spans a boundary
      if (buf.length > 3) buf = buf.slice(buf.length - 3);
      notifyConsumed();
      return;
    }

    if (idx > 0) {
      buf = buf.slice(idx);
      pageView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      idx = 0;
    }

    const BASE_HEADER_LEN = 27;
    if (buf.length < BASE_HEADER_LEN) {
      notifyConsumed();
      return;
    }

    const pageSegments = buf[26]!;
    const headerTotalLen = BASE_HEADER_LEN + pageSegments;
    if (buf.length < headerTotalLen) {
      notifyConsumed();
      return;
    }

    // Read segment table
    let payloadLen = 0;
    for (let i = 0; i < pageSegments; i++) {
      payloadLen += buf[BASE_HEADER_LEN + i]!;
    }

    const pageTotalLen = headerTotalLen + payloadLen;
    if (buf.length < pageTotalLen) {
      notifyConsumed();
      return;
    }

    // We have a full page
    const pageBytes = buf.slice(0, pageTotalLen);
    const payload = pageBytes.slice(headerTotalLen, pageTotalLen);

    // Parse header fields
    const headerType = pageBytes[5]!;
    const granulePosition = pageView.getBigUint64(6, true);
    const bitstreamSerialNumber = pageView.getUint32(14, true);
    const pageSequenceNumber = pageView.getUint32(18, true);

    try {
      const meta: PageMeta = {
        serial: bitstreamSerialNumber,
        granulePosition: granulePosition.toString(),
        pageSequenceNumber,
        headerType,
        payloadLength: payload.length
      };

      // Transfer the buffer to avoid copies
      self.postMessage({ type: 'page', page: pageBytes.buffer, meta }, { transfer: [pageBytes.buffer] });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }

    // Remove consumed bytes from buffer
    buf = buf.slice(pageTotalLen);
    consumedTotal += pageTotalLen;
    if (buf.length === 0) {
      notifyConsumed();
      return;
    }
    pageView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

self.addEventListener('message', (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === 'chunk') {
    try {
      appendBuffer(msg.chunk);
      processBuffer();
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  } else if (msg.type === 'end') {
    try {
      processBuffer();
      self.postMessage({ type: 'done' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
});
