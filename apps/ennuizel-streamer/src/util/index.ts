import { fileURLToPath } from 'node:url';

import type { WebSocket } from 'uWebSockets.js';

import type { StreamController } from './process.js';

export const DEV_MODE = import.meta.url.endsWith('.ts');
export const ROOT_DIR = fileURLToPath(new URL(DEV_MODE ? '../..' : '..', import.meta.url));

export type WebsocketData = {
  cancelTimeout(): void;
  ready: boolean;
  left: boolean;
  controller?: StreamController;
};

export function timeoutWebsocket(ws: WebSocket<any>, ms = 10000) {
  const timer = setTimeout(() => ws.close(), ms);
  return () => void clearTimeout(timer);
}
