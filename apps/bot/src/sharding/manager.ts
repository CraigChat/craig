import { EventEmitter, once } from 'node:events';
import path from 'node:path';

import { getSemaphore } from '@henrygd/semaphore';
import { EmojiManager } from '@snazzah/emoji-sync';

import { wait } from '../util.js';
import * as logger from './logger.js';
import ManagerModule from './module.js';
import Shard from './shard.js';
import { ManagerRequestMessage } from './types.js';

export interface ManagerOptions {
  file: string;
  emojiFolder: string;
  token: string;
  applicationID: string;
  shardCount: number;
  concurrency?: number;
  readyTimeout?: number;
  respawn?: boolean;
  args?: string[];
  execArgv?: string[];
  metricsPort?: number;
  control?: {
    host: string;
    port?: number;
    token?: string;
    allowEval: boolean;
    allowedCIDRs: string[];
    trustHeader?: string;
  };
}

export type CommandHandler<T = Record<string, any>> = (
  shard: Shard,
  msg: ManagerRequestMessage<T>,
  respond: (data: unknown) => Promise<void>
) => void | Promise<void>;

const IDENTIFY_RATE_LIMIT_MS = 5000;

export default class ShardManager extends EventEmitter {
  readonly options: ManagerOptions;
  readonly modules = new Map<string, ManagerModule>();
  commands = new Map<string, CommandHandler>();
  shards = new Map<number, Shard>();
  identifyRateLimits = new Map<number, number>();
  emojiSyncData: any[] | null = null;
  #emojis?: EmojiManager;
  #spawnPromises = new Map<number, Promise<Shard>>();

  constructor(options: ManagerOptions) {
    super();
    this.options = Object.assign(
      {
        readyTimeout: options.readyTimeout ?? 30000,
        respawn: options.respawn ?? true,
        concurrency: options.concurrency ?? 1,
        args: options.args ?? [],
        execArgv: options.execArgv ?? [],
        metricsPort: options.metricsPort ?? null
      },
      options
    );
    this.on('message', this._processCommand.bind(this));
    if (this.options.control?.allowEval)
      this.commands.set('managerEval', (shard, msg, respond) => {
        try {
          const r = Function('script', 'return eval(script)').call(this, msg.d.script);
          respond({ result: r });
        } catch (e) {
          respond({ result: null, error: e });
        }
      });
  }

  async syncEmojis() {
    this.#emojis ??= new EmojiManager({
      token: this.options.token,
      applicationId: this.options.applicationID
    });
    await this.#emojis.loadFromFolder(path.resolve(this.options.emojiFolder));
    await this.#emojis.sync();
    this.emojiSyncData = Array.from(this.#emojis.emojis.values());
  }

  async _processCommand(shard: Shard, msg: ManagerRequestMessage) {
    if (typeof msg !== 'object') return;
    if (!msg.t || !msg.n) return;
    if (!this.commands.has(msg.t)) return;
    const cmd = this.commands.get(msg.t)!;
    const respond = (data: unknown) => shard.send({ r: msg.n, d: data });
    try {
      if (cmd) await cmd(shard, msg, respond);
    } catch (e) {
      logger.error(`Error from shard ${shard.id} command ${msg.t}`, e);
    }
  }

  spawn(id: number, retryDelay = 500, respawnDelay = 0) {
    const existing = this.#spawnPromises.get(id);
    if (existing) return existing;

    const spawning = this.spawnWithRetry(id, retryDelay, respawnDelay);
    this.#spawnPromises.set(id, spawning);
    const cleanup = () => {
      if (this.#spawnPromises.get(id) === spawning) this.#spawnPromises.delete(id);
    };
    spawning.then(cleanup, cleanup);
    return spawning;
  }

  private async spawnWithRetry(id: number, retryDelay: number, respawnDelay: number) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 5; attempt++) {
      logger.info(`Spawning shard ${id}... (attempt ${attempt})`);
      try {
        await this.spawnOnce(id, respawnDelay);
        return this.shards.get(id)!;
      } catch (error) {
        lastError = error;
        logger.error(`Failed to spawn shard ${id}`, error);
      }
      if (attempt < 5) await wait(retryDelay);
    }

    throw lastError;
  }

  shardIdentified(id: number) {
    this.identifyRateLimits.set(this.#getRateLimitKey(id), Date.now());
    this.emit('shardIdentified');
  }

  private async spawnOnce(id: number, respawnDelay: number) {
    let shard = this.shards.get(id);
    if (!shard) {
      shard = new Shard(this, id);
      this.shards.set(id, shard);
      this.emit('launch', shard);
    }

    const ready = shard.process ? shard.respawn(respawnDelay) : shard.spawn();
    void ready.catch(() => undefined);
    await shard.waitForPreload();
    await this.identify(shard);
    await ready;
  }

  private async identify(shard: Shard) {
    const key = this.#getRateLimitKey(shard.id);
    const semaphore = getSemaphore(`shard-identify/${key}`);

    await semaphore.acquire();
    try {
      while (true) {
        if (this.hasShardAwaitingIdentification(key, shard.id)) {
          await once(this, 'shardIdentified');
          continue;
        }

        const lastIdentifyAt = this.identifyRateLimits.get(key) ?? 0;
        const remaining = IDENTIFY_RATE_LIMIT_MS - (Date.now() - lastIdentifyAt);
        if (remaining <= 0) break;
        await wait(remaining);
      }

      const identified = shard.waitForIdentify();
      shard.status = 'identifying';
      try {
        await shard.send({ t: 'connect' });
        await identified;
      } catch (error) {
        void identified.catch(() => undefined);
        throw error;
      }
    } finally {
      if (!shard.identified) shard.status = 'idle';
      this.emit('shardIdentified');
      semaphore.release();
    }
  }

  #getRateLimitKey(id: number) {
    return id % (this.options.concurrency || 1);
  }

  private hasShardAwaitingIdentification(key: number, id: number) {
    return Array.from(this.shards.values()).some(
      (shard) => shard.id !== id && !shard.identified && shard.status === 'identifying' && this.#getRateLimitKey(shard.id) === key
    );
  }

  async findGuild(guildID: string) {
    for (const shard of this.shards.values()) {
      try {
        const res = await shard.eval(`this.guilds.has('${guildID}')`);
        if (res) return shard;
      } catch (e) {}
    }
  }

  async spawnAll() {
    if (this.options.shardCount <= 0) return;

    const start = performance.now();
    await this.spawn(0);
    logger.info(`Spawned first shard in ${performance.now() - start}ms, spawning ${this.options.shardCount - 1} others...`);

    const ids = Array.from({ length: this.options.shardCount - 1 }, (_, index) => index + 1);
    await Promise.all(ids.map((id) => this.spawn(id)));
  }

  broadcast(message: any, excludedShard = null) {
    const promises = [];
    for (const shard of this.shards.values()) {
      if (shard.process && shard.id !== excludedShard) promises.push(shard.send(message));
    }
    return Promise.all(promises);
  }

  broadcastEval(script: any) {
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.eval(script));
    return Promise.all(promises);
  }

  fetchClientValues(prop: string, force = false) {
    if (this.shards.size === 0) return Promise.reject(new Error('No shards have been spawned.'));
    if (this.shards.size !== this.options.shardCount && !force) return Promise.reject(new Error('Still spawning shards.'));
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.fetchClientValue(prop));
    return Promise.all(promises);
  }

  async respawnAll(delay = 500, respawnDelay = 5000) {
    for (const shard of this.shards.values()) {
      await this.spawn(shard.id, delay, respawnDelay);
    }
  }

  // Module handling //

  async loadModules(...moduleObjects: any[]) {
    const modules = moduleObjects.map(this._resolveModule.bind(this));
    const loadOrder = this._getLoadOrder(modules);

    for (const modName of loadOrder) {
      const mod = modules.find((mod) => mod.options.name === modName)!;
      if (this.modules.has(mod.options.name)) throw new Error(`A module in the client already has been named "${mod.options.name}".`);
      logger.log(`Loading module "${modName}"`);
      this.modules.set(modName, mod);
      await mod._load();
    }
  }

  async loadModule(moduleObject: any) {
    const mod = this._resolveModule(moduleObject);
    if (this.modules.has(mod.options.name)) throw new Error(`A module in the client already has been named "${mod.options.name}".`);
    logger.log(`Loading module "${mod.options.name}"`);
    this.modules.set(mod.options.name, mod);
    await mod._load();
  }

  async unloadModule(moduleName: string) {
    if (!this.modules.has(moduleName)) return;
    const mod = this.modules.get(moduleName)!;
    logger.log(`Unloading module "${moduleName}"`);
    await mod.unload();
    this.modules.delete(moduleName);
  }

  /** @hidden */
  private _resolveModule(moduleObject: any) {
    if (typeof moduleObject === 'function') moduleObject = new moduleObject(this);
    else if (typeof moduleObject.default === 'function') moduleObject = new moduleObject.default(this);

    if (typeof moduleObject.load !== 'function') throw new Error(`Invalid module object to load: ${moduleObject}`);
    return moduleObject as ManagerModule;
  }

  /** @hidden */
  private _getLoadOrder(modules: ManagerModule[]) {
    const loadOrder: string[] = [];

    const insert = (mod: ManagerModule) => {
      if (mod.options.requires && mod.options.requires.length)
        mod.options.requires.forEach((modName) => {
          const dep = modules.find((mod) => mod.options.name === modName) || this.modules.get(modName);
          if (!dep) throw new Error(`Module '${mod.options.name}' requires dependency '${modName}' which does not exist!`);
          if (!this.modules.has(modName)) insert(dep);
        });
      if (!loadOrder.includes(mod.options.name)) loadOrder.push(mod.options.name);
    };

    modules.forEach((mod) => insert(mod));

    return loadOrder;
  }
}
