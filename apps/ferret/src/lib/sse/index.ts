import Emittery from 'emittery';

import type { EndMessageEvent, InitMessageEvent, PingMessageEvent, UpdateMessageEvent } from './types';

enum ConnectionReadyState {
  CONNECTING,
  READY,
  CLOSED
}

interface EmitterEvents {
  opened: undefined;
  retry: { attempts: number };
  closed: { reconnecting: boolean };

  init: InitMessageEvent['data'];
  ping: PingMessageEvent['data'];
  update: UpdateMessageEvent['data'];
  end: EndMessageEvent['data'];
}

export class SSEClient extends Emittery<EmitterEvents> {
  source?: EventSource;
  state = ConnectionReadyState.CLOSED;
  reconnect = true;
  retries = 0;
  #bindMap: Record<string, ((event: MessageEvent<any>) => Promise<void> | void) | keyof EmitterEvents> = {
    open: this.#onOpen,
    error: this.#onError,

    init: 'init',
    update: 'update',
    ping: 'ping',
    end: 'end'
  };
  #bindings: Record<string, (event: MessageEvent<any>) => Promise<void> | void> = {};

  constructor() {
    super();
    for (const event in this.#bindMap) {
      const binding = this.#bindMap[event];
      if (typeof binding === 'string') this.#bindings[event] = this.#forwardEvent.bind(this, binding);
      else this.#bindings[event] = binding.bind(this);
    }
  }

  connect(url: string | URL, withCredentials = false) {
    if (this.source) this.#close();
    this.state = ConnectionReadyState.CONNECTING;
    this.retries = 0;
    this.source = new EventSource(url, { withCredentials });
    for (const event in this.#bindings) this.source.addEventListener(event, this.#bindings[event]);
  }

  #onOpen() {
    this.state = ConnectionReadyState.READY;
    this.emit('opened');
  }

  #onError() {
    if (!this.reconnect) return this.#close(true);
    this.retries++;
    if (this.retries >= 5) return this.#close(true);
    this.state = ConnectionReadyState.CONNECTING;
    this.emit('retry', { attempts: this.retries });
  }

  #forwardEvent(eventName: keyof EmitterEvents, event: MessageEvent<string>) {
    const data = JSON.parse(event.data);
    this.emit(eventName, data);
  }

  close() {
    if (this.state === ConnectionReadyState.CLOSED) return;
    this.#close(true);
  }

  #close(notify = false) {
    if (this.source) {
      for (const event in this.#bindings) this.source.removeEventListener(event, this.#bindings[event]);
      this.source.close();
      this.source = undefined;
    }
    this.state = ConnectionReadyState.CLOSED;
    this.retries = 0;
    if (notify) this.emit('closed', { reconnecting: false });
  }
}
