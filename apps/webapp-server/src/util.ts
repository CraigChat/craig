import { Logger } from '@craig/logger';
import { type RawData, WebSocket } from 'ws';

import { WebappOpCloseReason } from './protocol.js';

export const debug = process.env.NODE_ENV !== 'production';
export const logger = new Logger('Webapp Server');

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

export function closeWebsocket(ws: WebSocket, reason?: WebappOpCloseReason) {
  ws.close(1000, reason ? Buffer.from([reason]) : undefined);
}

export function prettyLog(symbol: '+' | '-' | '>' | '<' | 'i', message: string) {
  logger.info(`[ ${symbol} ] ${message}`);
}
