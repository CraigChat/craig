import { DexareModule } from 'dexare';
import { nanoid } from 'nanoid';

import type { CraigBot } from '../bot';
import type { ManagerResponseMessage } from '../sharding/types';
import { makePlainError } from '../util';

// @ts-ignore
export default class ShardingModule extends DexareModule<CraigBot> {
  _awaitedPromises = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void; timeout: any }>();
  on = !!process.env.SHARD_COUNT;

  constructor(client: any) {
    super(client, {
      name: 'sharding',
      description: 'Module for communicating with the shard master'
    });

    this.filePath = __filename;
  }

  load() {
    if (!process.env.SHARD_COUNT || !process.send) this.logger.info('Shard master not found, skipping...');
    process.on('message', this.onMessage.bind(this));
    this.registerEvent('ready', this.onReady.bind(this));
    this.registerEvent('shardResume', this.onResume.bind(this));
    this.registerEvent('shardDisconnect', this.onDisconnect.bind(this));
    this.registerEvent('debug', this.onDebug.bind(this));
  }

  unload() {
    this.unregisterAllEvents();
  }

  async onMessage(message: any) {
    if (!process.env.SHARD_COUNT || !process.send) return;

    if (typeof message === 'object') {
      // Respond to requests
      if (message.r) {
        if (this._awaitedPromises.has(message.r)) {
          const { resolve, timeout } = this._awaitedPromises.get(message.r)!;
          clearTimeout(timeout);
          this._awaitedPromises.delete(message.r);
          resolve(message);
        }
        return;
      }

      switch (message.t) {
        case 'fetchProp': {
          try {
            const result = eval('this.client.' + message.d.prop);
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: makePlainError(e as any) });
          }
          return;
        }
        case 'eval': {
          try {
            const result = function () {
              return eval(message.d.script);
            }.bind(this.client)();
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: makePlainError(e as any) });
          }
          return;
        }
        case 'setStatus': {
          if (message.d.status === 'default') this.client.bot.editStatus('online', this.client.config.status);
          else if (message.d.status === 'custom' && message.d.message)
            // @ts-ignore
            this.client.bot.editStatus({
              type: 4,
              name: 'craig',
              state: message.d.message
            });
          else if (['online', 'idle', 'dnd'].includes(message.d.status) && message.d.message)
            this.client.bot.editStatus(message.d.status, {
              type: 0,
              name: message.d.message
            });
          if (message.n) this.respond(message.n, { ok: true });
          return;
        }
      }

      this.client.events.emit('processMessage', message);
    }
  }

  onReady() {
    this.send('ready');
  }

  onDisconnect(_: any, err?: Error) {
    this.send('disconnect', { error: err });
  }

  onResume() {
    this.send('resuming');
  }

  onDebug(_: any, message: string) {
    if (
      [
        'Immediately reconnecting for potential resume',
        'Queueing reconnect in ',
        'Automatically invalidating session due to excessive resume attempts'
      ].some((st) => message.startsWith(st))
    ) {
      this.client.emit('logger', 'info', 'eris', [message]);
      this.send('reconnecting', { msg: message });
    }
  }

  send(type: string, data: Record<string, any> = {}): void {
    process.send?.({
      t: type,
      n: nanoid(),
      d: {
        _guilds: this.client.bot.guilds.size,
        _status: this.client.shard?.status,
        ...data
      }
    });
  }

  respond(nonce: string, data: Record<string, any>): void {
    process.send?.({
      r: nonce,
      d: {
        _guilds: this.client.bot.guilds.size,
        _status: this.client.shard?.status,
        ...data
      }
    });
  }

  sendAndRecieve<T = any>(type: string, data: Record<string, any> = {}, timeoutMs = 5000): Promise<ManagerResponseMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!process.env.SHARD_COUNT || !process.send) return reject(new Error('This is not sharded.'));

      const nonce = nanoid();
      const timeout = setTimeout(() => {
        this._awaitedPromises.delete(nonce);
        reject(new Error('Request timed out.'));
      }, timeoutMs);
      this._awaitedPromises.set(nonce, { resolve, reject, timeout });
      process.send({
        t: type,
        n: nonce,
        d: {
          _guilds: this.client.bot.guilds.size,
          _status: this.client.shard?.status,
          ...data
        }
      });
    });
  }

  async getCounts(): Promise<[number, number]> {
    if (!this.on) return [this.client.bot.guilds.size, (this.client.modules.get('recorder')! as any).recordings.size];

    const a = await this.sendAndRecieve<{ guilds: number; recordings: number }>('getCounts');
    return [a.d.guilds, a.d.recordings];
  }
}
