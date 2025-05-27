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

export function convertToTimeMark(seconds: number, includeHours?: boolean): string {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds.toFixed(2)}` : `${remainingSeconds.toFixed(2)}`;

  return `${hours === 0 && !includeHours ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}
