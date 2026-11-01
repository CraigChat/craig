import { WebappOpCloseReason } from '@craig/common';
import { Logger } from '@craig/logger';
import type { FastifyRequest } from 'fastify';
import { RawData, WebSocket } from 'ws';

export const logger = new Logger('Webapp Server');

export const debug = process.env.NODE_ENV !== 'production';

// Same ADDRESS_HEADER/XFF_DEPTH semantics as the SvelteKit apps (adapter-node)
const addressHeader = process.env.ADDRESS_HEADER?.toLowerCase() || '';
const xffDepth = parseInt(process.env.XFF_DEPTH || '1', 10);
if (!Number.isInteger(xffDepth) || xffDepth < 1) throw new Error('XFF_DEPTH must be a positive integer');

export function getClientAddress(req: FastifyRequest) {
  if (!addressHeader) return req.ip;
  const header = req.headers[addressHeader];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return req.ip;
  if (addressHeader !== 'x-forwarded-for') return value.trim();

  const addresses = value.split(',');
  if (xffDepth > addresses.length) return req.ip;
  return addresses[addresses.length - xffDepth].trim();
}

export function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) return data;
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
