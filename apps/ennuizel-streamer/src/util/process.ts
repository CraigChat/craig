import { join } from 'node:path';

import type { RecordingNote } from '@craig/types/recording';
import { execaCommand } from 'execa';
import type { WebSocket } from 'uWebSockets.js';

import { REC_DIRECTORY } from './config.js';
import { ROOT_DIR } from './index.js';
import logger from './logger.js';
import { wsHistogram } from './metrics.js';
import { procOpts } from './processOptions.js';

export const DEF_TIMEOUT = 14400 * 1000;

export const SEND_SIZE = 65536;
export const MAX_ACK = 128;

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

  // Prevent further data from stderr from spilling out
  cancelSignal.addEventListener('abort', () => {
    childProcess.stderr.removeAllListeners('data');
  });

  return childProcess.stdout;
}

export type StreamController = {
  onMessage: (message: ArrayBuffer) => void;
  onEnd: () => void;
  onDrain: () => void;
  readable: () => void;
  setPaused: (value: boolean) => boolean;
};

export function streamController(ws: WebSocket<any>, id: string, track: number): StreamController {
  const timer = wsHistogram.startTimer();
  let paused = false,
    waitingForBackpressure = false,
    ackd = -1,
    sending = 0,
    buf: Buffer | null = Buffer.alloc(4);

  buf.writeUInt32LE(sending, 0);

  function onError(e: any) {
    logger.warn(`[${id}-${track}] Stream error`, e);
    endWS(1011);
  }

  function readable() {
    if (paused || waitingForBackpressure) return;
    try {
      let chunk;
      while ((chunk = stream.read(SEND_SIZE))) {
        setData(chunk);
        if (paused || waitingForBackpressure) break;
      }
    } catch (e) {
      onError(e);
    }
  }

  function setData(chunk: Buffer) {
    buf = Buffer.concat([buf!, chunk]);
    while (buf.length >= SEND_SIZE) sendBuffer();
  }

  function sendBuffer() {
    if (wsEnded) return;

    // Get the sendable part
    let toSend: Buffer;
    if (buf!.length > SEND_SIZE) {
      toSend = buf!.subarray(0, SEND_SIZE);
      buf = buf!.subarray(SEND_SIZE);
    } else {
      toSend = buf!;
      buf = null;
    }

    const status = ws.send(toSend, true);
    if (status !== 1) {
      logger.warn(`Recieved status after sending ${sending}[${ackd}]: ${status} (bp: ${ws.getBufferedAmount()})`);
      waitingForBackpressure = true;
    }

    const hdr = Buffer.alloc(4);
    sending++;
    hdr.writeUInt32LE(sending, 0);
    if (buf) buf = Buffer.concat([hdr, buf]);
    else buf = hdr;

    // Stop accepting data
    if (sending > ackd + MAX_ACK) paused = true;
  }

  const onDrain = () => {
    logger.info(`[${id}-${track}] Backpressure drained (${ws.getBufferedAmount()})`);
    const wasWaiting = waitingForBackpressure;
    waitingForBackpressure = false;
    if (wasWaiting && !paused) readable();
  };

  const onMessage = (message: ArrayBuffer) => {
    const msg = Buffer.from(message);
    const cmd = msg.readUInt32LE(0);
    const p = msg.readUInt32LE(4);
    if (cmd !== 0) {
      logger.warn(`[${id}-${track}] Got an unexpected command (${cmd})`);
      return endWS(1003);
    }
    if (p > ackd) {
      ackd = p;
      if (sending <= ackd + MAX_ACK) {
        // Accept data
        paused = false;
        if (!waitingForBackpressure) readable();
      }
    }
  };

  let wsEnded = false;
  const onEnd = () => {
    logger.log(`[${id}-${track}] Stream ended`);
    if (wsEnded) return;
    wsEnded = true;
    abortController.abort();
    timer();
  };
  const endWS = (code: number = 1000) => {
    if (wsEnded) return;
    wsEnded = true;
    try {
      ws.end(code);
    } catch {
      // Force close connection
      try {
        ws.close();
      } catch {}
    }
  };

  const setPaused = (value: boolean) => (paused = value);

  const abortController = new AbortController();
  const recFileBase = join(REC_DIRECTORY, `${id}.ogg`);
  const stream = rawPartwise({ recFileBase, track, cancelSignal: abortController.signal });
  stream.on('readable', readable);
  stream.once('end', () => {
    try {
      while (buf!.length > 4) sendBuffer();
      sendBuffer();
      endWS();
    } catch (e) {
      onError(e);
    }
  });
  stream.once('error', (e) => logger.log(`[${id}-${track}] Stream got partwise error`, e));
  stream.once('close', () => {
    endWS();
    stream.destroy();
  });
  logger.log(`[${id}-${track}] Stream ready`);

  return { onMessage, onEnd, readable, setPaused, onDrain };
}
