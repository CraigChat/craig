import EventEmitter from 'eventemitter3';
import { wait } from '../util';
import * as logger from './logger';
import ManagerModule from './module';
import Shard from './shard';
import { ManagerRequestMessage } from './types';

export interface ManagerOptions {
  file: string;
  shardCount: number;
  readyTimeout?: number;
  respawn?: boolean;
  args?: string[];
  execArgv?: string[];
}

export type CommandHandler = (shard: Shard, msg: any, respond: (data: any) => Promise<void>) => void | Promise<void>;

export default class ShardManager extends EventEmitter {
  readonly options: ManagerOptions;
  readonly modules = new Map<string, ManagerModule>();
  commands = new Map<string, CommandHandler>();
  shards = new Map<number, Shard>();

  constructor(options: ManagerOptions) {
    super();
    this.options = Object.assign(
      {
        readyTimeout: options.readyTimeout ?? 30000,
        respawn: options.respawn ?? true,
        args: options.args ?? [],
        execArgv: options.execArgv ?? []
      },
      options
    );
    this.on('message', this._processCommand.bind(this));
    this.commands.set('managerEval', (shard, msg, respond) => {
      try {
        const r = eval(msg.d.script);
        respond({ result: r });
      } catch (e) {
        respond({ result: null, error: e });
      }
    });
  }

  async _processCommand(shard: Shard, msg: ManagerRequestMessage) {
    if (typeof msg !== 'object') return;
    if (!msg.t || !msg.n) return;
    if (!this.commands.has(msg.t)) return;
    const cmd = this.commands.get(msg.t)!;
    const respond = (data: any) => shard.send({ r: msg.n, d: data });
    try {
      if (cmd) await cmd(shard, msg, respond);
    } catch (e) {
      logger.error(`Error from shard ${shard.id} command ${msg.t}`, e);
    }
  }

  spawn(id: number) {
    const shard = new Shard(this, id);
    this.shards.set(id, shard);
    this.emit('launch', shard);
    return shard.spawn();
  }

  async findGuild(guildID: string) {
    for (const shard of this.shards.values()) {
      try {
        const res = await shard.eval(`this.guilds.has('${guildID}')`);
        if (res) return shard;
      } catch (e) {}
    }
  }

  async spawnAll(delay = 500) {
    while (this.shards.size < this.options.shardCount) {
      const currentId = this.shards.size;
      let retries = 0;
      while (retries < 5) {
        logger.info(`Spawning shard ${currentId}... (attempt ${retries + 1})`);
        try {
          retries++;
          if (this.shards.has(currentId)) {
            const shard = this.shards.get(currentId)!;
            await shard.respawn(0);
          } else await this.spawn(currentId);
          break;
        } catch (e) {
          logger.error(`Failed to spawn shard ${currentId}`, e);
        }
        await wait(delay);
      }
    }
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

  fetchClientValues(prop: string) {
    if (this.shards.size === 0) return Promise.reject(new Error('No shards have been spawned.'));
    if (this.shards.size !== this.options.shardCount) return Promise.reject(new Error('Still spawning shards.'));
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.fetchClientValue(prop));
    return Promise.all(promises);
  }

  async respawnAll(delay = 500, respawnDelay = 5000) {
    for (const shard of this.shards.values()) {
      let retries = 0;
      while (retries < 5) {
        logger.info(`Respawning shard ${shard.id}... (attempt ${retries + 1})`);
        try {
          retries++;
          await shard.respawn(respawnDelay);
          break;
        } catch (e) {
          logger.error(`Failed to respawn shard ${shard.id}`, e);
        }
        await wait(delay);
      }
    }
  }

  // Module handling //

  async loadModules(...moduleObjects: any[]) {
    const modules = moduleObjects.map(this._resolveModule.bind(this));
    const loadOrder = this._getLoadOrder(modules);

    for (const modName of loadOrder) {
      const mod = modules.find((mod) => mod.options.name === modName)!;
      if (this.modules.has(mod.options.name))
        throw new Error(`A module in the client already has been named "${mod.options.name}".`);
      logger.log(`Loading module "${modName}"`);
      this.modules.set(modName, mod);
      await mod._load();
    }
  }

  async loadModule(moduleObject: any) {
    const mod = this._resolveModule(moduleObject);
    if (this.modules.has(mod.options.name))
      throw new Error(`A module in the client already has been named "${mod.options.name}".`);
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
          if (!dep)
            throw new Error(`Module '${mod.options.name}' requires dependency '${modName}' which does not exist!`);
          if (!this.modules.has(modName)) insert(dep);
        });
      if (!loadOrder.includes(mod.options.name)) loadOrder.push(mod.options.name);
    };

    modules.forEach((mod) => insert(mod));

    return loadOrder;
  }
}
