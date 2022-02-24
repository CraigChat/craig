import { DexareModule } from 'dexare';
import { nanoid } from 'nanoid';
import { CraigBot } from '../bot';
import type { ManagerResponseMessage } from '../sharding/types';

// @ts-ignore
export default class ShardingModule extends DexareModule<CraigBot> {
  _awaitedPromises = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>();

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
  }

  async onMessage(message: any) {
    if (!process.env.SHARD_COUNT || !process.send) return;

    if (typeof message === 'object') {
      // Respond to requests
      if (message.r && this._awaitedPromises.has(message.r)) {
        const { resolve } = this._awaitedPromises.get(message.r)!;
        this._awaitedPromises.delete(message.r);
        resolve(message);
        return;
      }

      switch (message.t) {
        case 'fetchProp':
          // TODO fetchProp shard commmand
          return;
        case 'eval':
          // TODO eval shard commmand
          return;
      }
    }
  }

  sendStatus(type: string): void {
    process.send?.({
      t: type,
      n: nanoid(),
      d: {
        _guilds: this.client.bot.guilds.size,
        _status: this.client.shard?.status
      }
    });
  }

  sendAndRecieve<T = any>(type: string, data: any): Promise<ManagerResponseMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!process.env.SHARD_COUNT || !process.send) return reject(new Error('This is not sharded.'));

      const nonce = nanoid();
      this._awaitedPromises.set(nonce, { resolve, reject });
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

  unload() {
    this.unregisterAllEvents();
  }
}
