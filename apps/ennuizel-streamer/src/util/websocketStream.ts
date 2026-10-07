import { Writable } from 'node:stream';

import type { WebSocket } from 'uWebSockets.js';

import type { WebsocketData } from './index.js';
import logger from './logger.js';
import { acksRecieved, dataSent } from './metrics.js';

export const SEND_SIZE = 65536;
export const MAX_ACK = 128;

type Callback = (error?: Error | null) => void;

export class WebSocketStream extends Writable {
  private readonly data: WebsocketData;
  private buffer: Buffer = Buffer.alloc(0);
  private sending = 0;
  private ackd = -1;
  private paused = false;
  private waitingForBackpressure = false;
  private wsEnded = false;
  private ending = false;
  private finalSeq = -1;
  private finalTimer?: ReturnType<typeof setTimeout>;
  private writeCallback?: Callback;
  private finalCallback?: Callback;

  constructor(
    private readonly ws: WebSocket<WebsocketData>,
    private readonly id: string,
    private readonly track: number
  ) {
    super({ autoDestroy: false });
    this.data = ws.getUserData();
  }

  private get isClosed() {
    return this.wsEnded || this.data.left || this.destroyed;
  }

  _write(chunk: Buffer, encoding: string, callback: Callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.writeCallback = callback;
    this.pump();
  }

  private sendFrame(length: number): boolean {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(this.sending);
    const frame = Buffer.concat([header, this.buffer.subarray(0, length)]);
    const status = this.ws.send(frame, true);
    // send() can synchronously trigger close; never touch the socket afterwards.
    if (this.isClosed) return false;
    if (status !== 1) {
      this.waitingForBackpressure = true;
      logger.debug(`[${this.id}-${this.track}] Send status=${status} seq=${this.sending} buffered=${this.ws.getBufferedAmount()}`);
    }
    // A dropped frame has not been queued. Keep its bytes and sequence for drain.
    if (status === 2) return false;
    this.buffer = this.buffer.subarray(length);
    this.sending++;
    dataSent.inc(frame.byteLength);
    return true;
  }

  private pump() {
    if (this.isClosed) return;
    try {
      while (!this.isClosed && !this.paused && !this.waitingForBackpressure && this.sending <= this.ackd + MAX_ACK) {
        if (this.buffer.length >= SEND_SIZE - 4 || (this.ending && this.buffer.length > 0)) {
          if (!this.sendFrame(Math.min(this.buffer.length, SEND_SIZE - 4))) break;
        } else if (this.ending && this.finalSeq < 0) {
          if (!this.sendFrame(0)) break;
          this.finalSeq = this.sending - 1;
          logger.info(`[${this.id}-${this.track}] Sent final frame; finalSeq=${this.finalSeq} ackd=${this.ackd}`);
          this.finalTimer = setTimeout(() => {
            if (this.isClosed) return;
            logger.warn(`[${this.id}-${this.track}] Final ACK timeout; closing socket (ackd=${this.ackd} expected=${this.finalSeq})`);
            this.endStream();
          }, 3000);
          const callback = this.finalCallback;
          this.finalCallback = undefined;
          callback?.();
          break;
        } else break;
      }
      if (this.isClosed) return;
      this.maybeClose();
      if (this.isClosed) return;
      if (this.buffer.length < SEND_SIZE - 4 && !this.waitingForBackpressure && !this.paused && this.sending <= this.ackd + MAX_ACK) {
        const callback = this.writeCallback;
        this.writeCallback = undefined;
        callback?.();
      }
    } catch (e) {
      this.destroy(e instanceof Error ? e : new Error(String(e)));
    }
  }

  setPaused(value: boolean): boolean {
    this.paused = value;
    if (!value) this.pump();
    return value;
  }

  onMessage(message: ArrayBuffer) {
    if (this.isClosed) return;
    const msg = Buffer.from(message);
    if (msg.length < 8) {
      logger.warn(`[${this.id}-${this.track}] Invalid ACK length (${msg.length})`);
      this.endStream(1003);
      return;
    }
    const cmd = msg.readUInt32LE(0);
    const seq = msg.readUInt32LE(4);
    if (cmd !== 0 || seq >= this.sending) {
      logger.warn(`[${this.id}-${this.track}] Invalid ACK command=${cmd} seq=${seq} lastSent=${this.sending - 1}`);
      this.endStream(1003);
      return;
    }
    if (seq > this.ackd) {
      this.ackd = seq;
      acksRecieved.inc();
      this.pump();
    }
  }

  onDrain() {
    if (this.isClosed) return;
    this.waitingForBackpressure = false;
    this.pump();
  }

  private maybeClose() {
    if (!this.isClosed && !this.waitingForBackpressure && this.finalSeq >= 0 && this.ackd >= this.finalSeq) {
      logger.info(`[${this.id}-${this.track}] Final ACK received; closing stream`);
      this.endStream();
    }
  }

  endStream(code = 1000) {
    // Pipeline errors destroy the Writable before requesting a socket close.
    if (this.wsEnded || this.data.left) return;
    logger.info(
      `[${this.id}-${this.track}] Ending stream (code=${code}) buffered=${this.ws.getBufferedAmount()} lastSent=${this.sending - 1} ackd=${this.ackd}`
    );
    this.wsEnded = true;
    this.clearFinalTimer();
    this.ws.end(code);
  }

  onEnd() {
    this.wsEnded = true;
    this.clearFinalTimer();
    this.destroy();
  }

  private clearFinalTimer() {
    if (this.finalTimer) clearTimeout(this.finalTimer);
    this.finalTimer = undefined;
  }

  _final(callback: Callback) {
    this.ending = true;
    this.finalCallback = callback;
    this.pump();
  }

  _destroy(error: Error | null, callback: Callback) {
    this.clearFinalTimer();
    this.buffer = Buffer.alloc(0);
    const writeCallback = this.writeCallback;
    const finalCallback = this.finalCallback;
    this.writeCallback = this.finalCallback = undefined;
    const pendingError = error || new Error('WebSocket stream closed');
    writeCallback?.(pendingError);
    finalCallback?.(pendingError);
    callback(error);
  }
}
