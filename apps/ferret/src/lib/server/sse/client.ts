import EventEmitter from 'eventemitter3';
import { nanoid } from 'nanoid';

import { logger } from '$lib/server/logger';

import type { AnyMessageEvent, MessageEvent } from '../../sse/types';

export enum ConnectionReadyState {
  CONNECTING,
  READY,
  CLOSED
}

export function writeMessage(event: MessageEvent): string {
  let payload = '';

  if (event.id) payload += `id: ${event.id}\n`;
  if (event.event) payload += `event: ${event.event}\n`;
  if (event.data) payload += `data: ${JSON.stringify(event.data)}\n`;
  if (event.retry) payload += `retry: ${event.retry}\n`;
  if (!payload) return '';
  payload += '\n';

  return payload;
}

export class SSEResponse extends Response {
  constructor(messages: AnyMessageEvent[], headers?: Record<string, string>) {
    super(messages.map(writeMessage).join(''), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...headers
      }
    });
  }
}

export class SSEConnection extends EventEmitter {
  stream: ReadableStream<any>;
  controller?: ReadableStreamDefaultController;
  #pingTimer?: ReturnType<typeof setInterval>;
  state = ConnectionReadyState.CONNECTING;
  id = nanoid();

  constructor() {
    super();
    this.stream = new ReadableStream({
      start: (controller) => this.#onStreamStart(controller),
      cancel: () => this.#onStreamCancel()
    });
    this.#log('init');
  }

  #onClose() {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.state = ConnectionReadyState.CLOSED;
    this.emit('close');
    this.#log('Connection closed');
  }

  #onStreamCancel() {
    this.#log('Client disconnected');
    this.#onClose();
  }

  #onStreamStart(controller: ReadableStreamDefaultController) {
    this.controller = controller;
    this.#pingTimer = setInterval(() => {
      this.send({
        event: 'ping',
        data: { t: Date.now() }
      });
    }, 5000);
    this.state = ConnectionReadyState.READY;
    this.emit('start');
    this.#log('Connection started');
  }

  send(message: AnyMessageEvent) {
    // if (this.state === ConnectionReadyState.CLOSED) throw new Error('Tried to send message to a closed connection');
    if (this.state === ConnectionReadyState.CLOSED) return;
    try {
      this.controller?.enqueue(writeMessage(message));
    } catch {}
  }

  close() {
    this.send({ event: 'end', data: {} });
    try {
      // May throw if this connection was already closed
      this.controller?.close();
    } catch (e) {}
    this.#log('Closing connection');
    this.#onClose();
  }

  #log(message: string, ...args: any[]) {
    logger.debug(`[SSE_CONNECTION:${this.id}] ${message}`, ...args);
  }
}
