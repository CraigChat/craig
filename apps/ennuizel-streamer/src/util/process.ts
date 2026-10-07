import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { RecordingNote } from '@craig/types/recording';
import { execaCommand } from 'execa';
import type { WebSocket } from 'uWebSockets.js';

import { REC_DIRECTORY } from './config.js';
import { ROOT_DIR, WebsocketData } from './index.js';
import logger from './logger.js';
import { wsHistogram } from './metrics.js';
import { procOpts } from './processOptions.js';
import { WebSocketStream } from './websocketStream.js';

export { MAX_ACK, SEND_SIZE } from './websocketStream.js';

export const DEF_TIMEOUT = 14400 * 1000;

interface CommonProcessOptions {
  recFileBase: string;
  cancelSignal: AbortSignal;
}

export async function getNotes({ recFileBase, cancelSignal }: CommonProcessOptions) {
  const subprocess = execaCommand(
    [['cat', ...['header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '), './cook/extnotes -f json'].join(' | '),
    { cancelSignal, shell: true, cwd: ROOT_DIR }
  );
  const { stdout } = await subprocess;
  return JSON.parse(stdout) as RecordingNote[];
}

interface RawPartwiseOptions extends CommonProcessOptions {
  track: number;
}

export function rawPartwise({ recFileBase, track, cancelSignal }: RawPartwiseOptions) {
  const pOpts = procOpts();

  const commands = [
    ['cat', ...['header1', 'header2', 'data', 'header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '),
    `${pOpts} ./cook/oggcorrect ${track}`
  ];

  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });

  childProcess.stderr.on('data', () => {});
  childProcess.stderr.on('error', () => {});

  return childProcess;
}

export type StreamController = {
  onMessage: (message: ArrayBuffer) => void;
  onEnd: () => void;
  onDrain: () => void;
  readable: () => void;
  setPaused: (value: boolean) => boolean;
};

export function streamController(ws: WebSocket<WebsocketData>, id: string, track: number): StreamController {
  const data = ws.getUserData();
  let ended = false;
  const timer = wsHistogram.startTimer();
  const wsStream = new WebSocketStream(ws, id, track);
  const abortController = new AbortController();

  const recFileBase = join(REC_DIRECTORY, `${id}.ogg`);
  const childProcess = rawPartwise({ recFileBase, track, cancelSignal: abortController.signal });

  childProcess.on('spawn', () => logger.info(`[${id}-${track}] Process spawned`));
  childProcess.on('exit', (code, signal) => logger.log(`[${id}-${track}] Process exited (${code}, ${signal})`));
  childProcess.on('error', (e) => {
    logger.log(`[${id}-${track}] Process errored (${e})`);
    wsStream.endStream(1003);
  });

  childProcess.catch((e) => {
    if (!data.left) logger.warn(`[${id}-${track}] Process error: ${e}`);
  });

  pipeline(childProcess.stdout, wsStream).catch((e) => {
    if (!data.left) logger.warn(`[${id}-${track}] Pipeline error`, e);
    wsStream.endStream(1011);
  });

  logger.log(`[${id}-${track}] Stream ready with process ${childProcess.pid}`);

  const killProcess = () => {
    if (childProcess.exitCode === null) {
      logger.log(`[${id}-${track}] Killing process...`);
      const success = childProcess.kill();
      if (!success) logger.log(`[${id}-${track}] Process killing did not succeed (ec: ${childProcess.exitCode})`);
    }
  };

  return {
    onMessage: (message: ArrayBuffer) => wsStream.onMessage(message),
    onEnd: () => {
      if (ended) return;
      ended = true;
      wsStream.onEnd();
      logger.log(`[${id}-${track}] Stream ended`);
      killProcess();
      abortController.abort();
      timer();
    },
    onDrain: () => wsStream.onDrain(),
    readable: () => wsStream.setPaused(false),
    setPaused: (value: boolean) => wsStream.setPaused(value)
  };
}
