import { RawData, WebSocket } from 'ws';

export function toBuffer(data: RawData) {
  if (data instanceof Buffer) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function timeoutWebsocket(ws: WebSocket, ms = 10000) {
  const timer = setTimeout(() => ws.close(), ms);
  ws.once('close', () => clearTimeout(timer));
  ws.once('message', () => clearTimeout(timer));
}
