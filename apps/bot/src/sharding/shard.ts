import childProcess, { ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import path from 'node:path';

import { nanoid } from 'nanoid';

import { makeError, makePlainError, wait } from '../util.js';
import * as logger from './logger.js';
import ShardManager from './manager.js';
import { ManagerRequestMessage, ManagerResponseMessage, ShardEvalResponse } from './types.js';

interface AwaitedPromise<T = unknown> {
  resolve: (value: ManagerResponseMessage<T>) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export default class Shard extends EventEmitter {
  id: number;
  manager: ShardManager;
  env: NodeJS.ProcessEnv;
  ready = false;
  guildCount = 0;
  status = 'idle';
  lastActivity = 0;
  respawnWhenAvailable = false;
  process: ChildProcess | null = null;
  _awaitedPromises = new Map<string, AwaitedPromise>();
  _exitListener: () => void;

  constructor(manager: ShardManager, id: number) {
    super();
    this.id = id;
    this.manager = manager;
    this.env = { ...process.env };

    this._exitListener = this._handleExit.bind(this, undefined);
  }

  spawn(args = this.manager.options.args, execArgv = this.manager.options.execArgv) {
    this.process = childProcess
      .fork(path.resolve(process.cwd(), this.manager.options.file), args, {
        env: {
          ...this.env,
          SHARD_ID: String(this.id),
          SHARD_COUNT: String(this.manager.options.shardCount),
          ...(this.manager.emojiSyncData ? { EMOJI_SYNC_DATA: JSON.stringify(this.manager.emojiSyncData) } : {})
        },
        execArgv
      })
      .on('error', (e) => {
        this.emit('shardError', e);
        this.manager.emit('shardError', this, e);
      })
      .on('exit', this._exitListener)
      .on('message', this._handleMessage.bind(this));

    this.emit('spawn', this.process);
    this.manager.emit('shardSpawn', this);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Shard ${this.id}'s Client took too long to become ready.`));
      }, this.manager.options.readyTimeout);
      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('ready', onReady);
        this.removeListener('death', onDeath);
      };
      const onReady = () => {
        cleanup();
        resolve(this.process);
      };
      const onDeath = () => {
        cleanup();
        reject(new Error(`Shard ${this.id}'s process exited before its Client became ready.`));
      };

      this.once('ready', onReady);
      this.once('death', onDeath);
    }).then(() => this.process);
  }

  respawn(delay = 500) {
    this.kill();
    if (delay > 0) return wait(delay).then(() => this.spawn());
    return this.spawn();
  }

  async respawnWithRetry(delay = 500, respawnDelay = 1000) {
    let retries = 0;
    let ok = false;
    let lastError: unknown;
    while (retries < 5) {
      logger.info(`Respawning shard ${this.id}... (attempt ${retries + 1})`);
      try {
        retries++;
        await this.respawn(respawnDelay);
        ok = true;
        break;
      } catch (e) {
        logger.error(`Failed to respawn shard ${this.id}`, e);
        lastError = e;
      }
      await wait(delay);
    }

    if (!ok) throw lastError;
  }

  kill() {
    this.process!.removeListener('exit', this._exitListener);
    this.process!.kill();
    this._handleExit(false);
  }

  send(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process) return reject(new Error('Shard is not running.'));
      this.process.send(message, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async fetchClientValue(prop: string): Promise<unknown> {
    if (!this.process) return Promise.reject(new Error('Shard is not running.'));
    const response = await this.sendAndRecieve<ShardEvalResponse>('fetchProp', { prop });
    if (!response.d.error) return response.d.result;
    else throw makeError(response.d.error);
  }

  async eval(script: string): Promise<unknown> {
    if (!this.process) return Promise.reject(new Error('Shard is not running.'));
    const response = await this.sendAndRecieve<ShardEvalResponse>('eval', { script });
    if (!response.d.error) return response.d.result;
    else throw makeError(response.d.error);
  }

  _handleMessage(message: ManagerRequestMessage | ManagerResponseMessage | unknown) {
    const now = Date.now();
    if (now > this.lastActivity) this.lastActivity = now;

    if (message && typeof message === 'object') {
      const ipcMessage = message as Partial<ManagerRequestMessage & ManagerResponseMessage>;
      // Respond to requests
      if (ipcMessage.r && this._awaitedPromises.has(ipcMessage.r)) {
        const awaited = this._awaitedPromises.get(ipcMessage.r)!;
        this._awaitedPromises.delete(ipcMessage.r);
        clearTimeout(awaited.timeout);
        awaited.resolve(message as ManagerResponseMessage);
        return;
      }

      if (ipcMessage.t) {
        const data = ipcMessage.d as Record<string, unknown> | undefined;
        if (typeof data?._status === 'string') this.status = data._status;
        if (typeof data?._guilds === 'number') this.guildCount = data._guilds;
        switch (ipcMessage.t) {
          case 'ready':
            this.ready = true;
            this.emit('ready', ipcMessage);
            this.manager.emit('ready', this, ipcMessage);
            return;
          case 'disconnect':
            this.ready = false;
            this.emit('disconnect', data?.error);
            this.manager.emit('disconnect', this, data?.error);
            return;
          case 'reconnecting':
            this.ready = false;
            this.emit('reconnecting', data?.msg);
            this.manager.emit('reconnecting', this, data?.msg);
            return;
          case 'resuming':
            this.ready = false;
            this.emit('resuming');
            this.manager.emit('resuming', this);
            return;
          case 'error':
            this.ready = false;
            this.emit('shardError', data?.error);
            this.manager.emit('shardError', this, data?.error);
            return;
          case 'fetchProp':
            this.manager.fetchClientValues(String(data?.prop)).then(
              (results) => this.send({ r: ipcMessage.n, d: { result: results } }),
              (err) => this.send({ r: ipcMessage.n, d: { error: makePlainError(err) } })
            );
            return;
          case 'eval':
            this.manager.broadcastEval(String(data?.script)).then(
              (results) => this.send({ r: ipcMessage.n, d: { result: results } }),
              (err) => this.send({ r: ipcMessage.n, d: { error: makePlainError(err) } })
            );
            return;
          case 'findGuild':
            if (data?.guild && ipcMessage.n)
              this.manager.findGuild(String(data.guild)).then(
                (shard) => this.send({ r: ipcMessage.n, d: { shard: shard ? shard.id : undefined } }),
                (err) => this.send({ r: ipcMessage.n, d: { _error: makePlainError(err) } })
              );
            return;
          case 'ping':
            return;
        }
      }
    }

    this.manager.emit('message', this, message);
    this.emit('message', message);
  }

  /**
   * Handles the shard's process exiting.
   * @param {boolean} [respawn=this.manager.respawn] Whether to spawn the shard again
   * @private
   */
  _handleExit(respawn = this.manager.options.respawn) {
    this.emit('death', this.process);

    this.process = null;
    for (const awaited of this._awaitedPromises.values()) {
      clearTimeout(awaited.timeout);
      awaited.reject(new Error(`Shard ${this.id}'s process exited before responding.`));
    }
    this._awaitedPromises.clear();

    if (respawn) this.manager.spawn(this.id);
  }

  sendAndRecieve<T = unknown>(type: string, data: unknown, timeoutMs = 5000): Promise<ManagerResponseMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!this.process) return reject(new Error('Shard is not running.'));

      const nonce = nanoid();
      const timeout = setTimeout(() => {
        this._awaitedPromises.delete(nonce);
        reject(new Error(`Shard ${this.id} did not respond to ${type} within ${timeoutMs}ms.`));
      }, timeoutMs);
      this._awaitedPromises.set(nonce, { resolve: resolve as AwaitedPromise['resolve'], reject, timeout });
      this.process!.send({
        t: type,
        n: nonce,
        d: data
      });
    });
  }
}
