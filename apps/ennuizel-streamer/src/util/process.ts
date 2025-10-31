import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { RecordingNote } from '@craig/types/recording';
import { execaCommand } from 'execa';
import type { WebSocket } from 'uWebSockets.js';

import { REC_DIRECTORY } from './config.js';
import { ROOT_DIR, WebsocketData } from './index.js';
import logger from './logger.js';
import { acksRecieved, dataSent, wsHistogram } from './metrics.js';
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

  return childProcess;
}

export type StreamController = {
  onMessage: (message: ArrayBuffer) => void;
  onEnd: () => void;
  onDrain: () => void;
  readable: () => void;
  setPaused: (value: boolean) => boolean;
};

class WebSocketStream extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private sending = 0;
  private ackd = -1;
  private shouldPause = false;
  private waitingForBackpressure = false;
  private wsEnded = false;
  // Finalization/EOF coordination
  private ending = false;
  private finalSeq = -1;
  private finalTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly ws: WebSocket<WebsocketData>,
    private readonly id: string,
    private readonly track: number
  ) {
    super();
  }

  _transform(chunk: Buffer, encoding: string, callback: (error?: Error | null, data?: any) => void) {
    try {
      this.setData(chunk);
      callback();
    } catch (e) {
      callback(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private setData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= SEND_SIZE - 4 && !this.ws.getUserData().left)
      this.sendBuffer();
  }

  private sendBuffer() {
    if (this.wsEnded || this.ws.getUserData().left) return;

    // Get the sendable part
    let toSend: Buffer;
    if (this.buffer.length > SEND_SIZE - 4) {
      const chunk = this.buffer.subarray(0, SEND_SIZE - 4);

      const seqHeader = Buffer.alloc(4);
      seqHeader.writeUInt32LE(this.sending, 0);
      toSend = Buffer.concat([seqHeader, chunk]);

      this.buffer = this.buffer.subarray(SEND_SIZE - 4);
    } else {
      const seqHeader = Buffer.alloc(4);
      seqHeader.writeUInt32LE(this.sending, 0);

      toSend = Buffer.concat([seqHeader, this.buffer]);
      this.buffer = Buffer.alloc(0);
    }

    const status = this.ws.send(toSend, true);
    if (status !== 1) {
      logger.warn(`Recieved status after sending ${this.sending}[${this.ackd}]: ${status} (bp: ${this.ws.getBufferedAmount()})`);
      this.waitingForBackpressure = true;
      this.pause();
    }
    dataSent.inc(toSend.byteLength);

    this.sending++;

    // Stop accepting data
    if (this.sending > this.ackd + MAX_ACK) {
      this.shouldPause = true;
      this.pause();
    }
  }

  setPaused(value: boolean): boolean {
    this.shouldPause = value;
    if (value) this.pause();
    else if (!this.waitingForBackpressure) this.resume();
    return value;
  }

  onMessage(message: ArrayBuffer) {
    const msg = Buffer.from(message);
    const cmd = msg.readUInt32LE(0);
    const p = msg.readUInt32LE(4);
    if (cmd !== 0) {
      logger.warn(`[${this.id}-${this.track}] Got an unexpected command (${cmd})`);
      this.endStream(1003);
      return;
    }
    if (p > this.ackd) {
      this.ackd = p;
      acksRecieved.inc();
      if (this.sending <= this.ackd + MAX_ACK) {
        this.shouldPause = false;
        if (!this.waitingForBackpressure) this.resume();
      }
      if (this.ending) this.maybeClose();
    }
  }

  onDrain() {
    logger.info(`[${this.id}-${this.track}] Backpressure drained (${this.ws.getBufferedAmount()})`);
    this.waitingForBackpressure = false;
    if (!this.shouldPause) this.resume();
    if (this.ending) this.maybeClose();
  }

  private maybeClose() {
    if (this.wsEnded || this.ws.getUserData().left) return;
    if (this.waitingForBackpressure) return;
    if (this.ending && this.ackd >= this.finalSeq) {
      if (this.finalTimer) {
        clearTimeout(this.finalTimer);
        this.finalTimer = undefined;
      }
      logger.info(`[${this.id}-${this.track}] Final ACK received (ackd=${this.ackd} finalSeq=${this.finalSeq}); closing stream`);
      this.endStream();
    }
  }

  endStream(code = 1000) {
    if (!this.wsEnded) {
      this.wsEnded = true;
      logger.info(`[${this.id}-${this.track}] Ending stream (code=${code}) buffered=${this.ws.getBufferedAmount()} lastSent=${this.sending - 1} ackd=${this.ackd}`);
      try {
        if (!this.ws.getUserData().left) {
          this.ws.end(code);
        }
      } catch {
        try {
          if (!this.ws.getUserData().left) {
            this.ws.close();
          }
        } catch {}
      }
    }
  }

  _final(callback: (error?: Error | null) => void) {
    try {
      // Flush full chunks
      while (this.buffer.length >= SEND_SIZE - 4 && !this.ws.getUserData().left) this.sendBuffer();

      // Send remaining partial content
      if (this.buffer.length > 0 && !this.ws.getUserData().left) this.sendBuffer();

      // Send end frame
      if (!this.ws.getUserData().left) this.sendBuffer();

      this.ending = true;
      this.finalSeq = this.sending - 1;
      logger.info(`[${this.id}-${this.track}] Sent final frame; finalSeq=${this.finalSeq} ackd=${this.ackd} buffered=${this.ws.getBufferedAmount()}`);

      this.maybeClose();

      // Force close after a bit if it hangs
      if (!this.wsEnded)
        this.finalTimer = setTimeout(() => {
          logger.warn(`[${this.id}-${this.track}] Final ACK timeout; closing socket (ackd=${this.ackd} expected=${this.finalSeq})`);
          this.endStream();
        }, 3000);

      callback();
    } catch (e) {
      callback(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export function streamController(ws: WebSocket<WebsocketData>, id: string, track: number): StreamController {
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
    if (!ws.getUserData().left) logger.warn(`[${id}-${track}] Process error: ${e}`);
  });

  pipeline(childProcess.stdout, wsStream).catch((e) => {
    logger.warn(`[${id}-${track}] Pipeline error`, e);
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
      logger.log(`[${id}-${track}] Stream ended`);
      killProcess();
      abortController.abort();
      timer();
    },
    onDrain: () => wsStream.onDrain(),
    readable: () => wsStream.resume(),
    setPaused: (value: boolean) => wsStream.setPaused(value)
  };
}
