import { nanoid } from 'nanoid';

import type { CraigBot } from '../bot.js';
import { BotModule } from '../runtime.js';
import type { ManagerResponseMessage } from '../sharding/types.js';
import { makePlainError } from '../util.js';

export default class ShardingModule extends BotModule {
  _awaitedPromises = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void; timeout: any }>();
  on = !!process.env.SHARD_COUNT;
  private readonly handleMessage = this.onMessage.bind(this);
  private readonly handleReady = this.onReady.bind(this);
  private readonly handleResume = this.onResume.bind(this);
  private readonly handleDisconnect = this.onDisconnect.bind(this);
  private readonly handleDebug = this.onDebug.bind(this);

  constructor(client: CraigBot) {
    super(client, {
      name: 'sharding',
      description: 'Module for communicating with the shard master'
    });
  }

  load() {
    if (!process.env.SHARD_COUNT || !process.send) this.logger.info('Shard master not found, skipping...');
    process.on('message', this.handleMessage);
    this.client.bot.on('ready', this.handleReady);
    this.client.bot.on('shardResume', this.handleResume);
    this.client.bot.on('shardDisconnect', this.handleDisconnect);
    this.client.bot.on('debug', this.handleDebug);
  }

  unload() {
    process.removeListener('message', this.handleMessage);
    this.client.bot.removeListener('ready', this.handleReady);
    this.client.bot.removeListener('shardResume', this.handleResume);
    this.client.bot.removeListener('shardDisconnect', this.handleDisconnect);
    this.client.bot.removeListener('debug', this.handleDebug);
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
            const result = this.evaluate(`this.${message.d.prop}`);
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: makePlainError(e as any) });
          }
          return;
        }
        case 'eval': {
          try {
            const result = this.evaluate(message.d.script);
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: makePlainError(e as any) });
          }
          return;
        }
        case 'setStatus': {
          if (message.d.status === 'default') this.client.bot.editStatus('online', this.client.config.status);
          else if (message.d.status === 'custom' && message.d.message)
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
    }
  }

  onReady() {
    this.send('ready');
  }

  onDisconnect(err?: Error) {
    this.send('disconnect', { error: err });
  }

  onResume() {
    this.send('resuming');
  }

  onDebug(message: string) {
    if (
      [
        'Immediately reconnecting for potential resume',
        'Queueing reconnect in ',
        'Automatically invalidating session due to excessive resume attempts'
      ].some((st) => message.startsWith(st))
    ) {
      this.client.log('info', 'dysnomia', [message]);
      this.send('reconnecting', { msg: message });
    }
  }

  evaluate(script: string) {
    const run = Function('script', 'return eval(script)');
    return run.call(this.client, script);
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
    if (!this.on) return [this.client.bot.guilds.size, this.client.recorder.recordings.size];

    const a = await this.sendAndRecieve<{ guilds: number; recordings: number }>('getCounts');
    return [a.d.guilds, a.d.recordings];
  }
}
