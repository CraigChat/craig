import childProcess, { ChildProcess } from 'child_process';
import EventEmitter from 'events';
import { nanoid } from 'nanoid';
import path from 'path';

import { makeError, makePlainError, wait } from '../util';
import * as logger from './logger';
import ShardManager from './manager';
import { ManagerResponseMessage, ShardEvalResponse } from './types';

export default class Shard extends EventEmitter {
  id: number;
  manager: ShardManager;
  env: { [key: string]: any };
  ready = false;
  guildCount = 0;
  status = 'idle';
  lastActivity = 0;
  respawnWhenAvailable = false;
  process: ChildProcess | null = null;
  _awaitedPromises = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>();
  _exitListener: any;

  constructor(manager: ShardManager, id: number) {
    super();
    this.id = id;
    this.manager = manager;
    this.env = Object.assign({}, process.env, {
      SHARD_ID: this.id,
      SHARD_COUNT: this.manager.options.shardCount,
      ...(this.manager.emojiSyncData ? { EMOJI_SYNC_DATA: JSON.stringify(this.manager.emojiSyncData) } : {})
    });

    this._exitListener = this._handleExit.bind(this, undefined);
  }

  spawn(args = this.manager.options.args, execArgv = this.manager.options.execArgv) {
    this.process = childProcess
      .fork(path.resolve(__dirname, '..', this.manager.options.file), args, {
        env: this.env,
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
      this.once('ready', resolve);
      // this.once('disconnect', () => reject(new Error(`Shard ${this.id}'s Client disconnected before becoming ready.`)));
      this.once('death', () => reject(new Error(`Shard ${this.id}'s process exited before its Client became ready.`)));
      setTimeout(() => reject(new Error(`Shard ${this.id}'s Client took too long to become ready.`)), this.manager.options.readyTimeout);
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
    let lastError: any;
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

  async fetchClientValue(prop: string): Promise<any> {
    if (!this.process) return Promise.reject(new Error('Shard is not running.'));
    const response = await this.sendAndRecieve<ShardEvalResponse>('fetchProp', { prop });
    if (!response.d.error) return response.d.result;
    else throw makeError(response.d.error);
  }

  async eval(script: string): Promise<any> {
    if (!this.process) return Promise.reject(new Error('Shard is not running.'));
    const response = await this.sendAndRecieve<ShardEvalResponse>('eval', { script });
    if (!response.d.error) return response.d.result;
    else throw makeError(response.d.error);
  }

  _handleMessage(message: any) {
    const now = Date.now();
    if (now > this.lastActivity) this.lastActivity = now;

    if (typeof message === 'object') {
      // Respond to requests
      if (message.r && this._awaitedPromises.has(message.r)) {
        const { resolve } = this._awaitedPromises.get(message.r)!;
        this._awaitedPromises.delete(message.r);
        resolve(message);
        return;
      }

      if (message.t) {
        if (message.d?._status) this.status = message.d._status;
        if (message.d?._guilds) this.guildCount = message.d._guilds;
        switch (message.t) {
          case 'ready':
            this.ready = true;
            this.emit('ready', message);
            this.manager.emit('ready', this, message);
            return;
          case 'disconnect':
            this.ready = false;
            this.emit('disconnect', message.error);
            this.manager.emit('disconnect', this, message.d.error);
            return;
          case 'reconnecting':
            this.ready = false;
            this.emit('reconnecting', message.msg);
            this.manager.emit('reconnecting', this, message.d.msg);
            return;
          case 'resumed':
            this.ready = false;
            this.emit('resumed');
            this.manager.emit('resumed', this);
            return;
          case 'error':
            this.ready = false;
            this.emit('shardError', message.d.error);
            this.manager.emit('shardError', this, message.d.error);
            return;
          case 'fetchProp':
            this.manager.fetchClientValues(message._sFetchProp).then(
              (results) => this.send({ r: message.r, d: { result: results } }),
              (err) => this.send({ r: message.r, d: { error: makePlainError(err) } })
            );
            return;
          case 'eval':
            this.manager.broadcastEval(message._sEval).then(
              (results) => this.send({ r: message.r, d: { result: results } }),
              (err) => this.send({ r: message.r, d: { error: makePlainError(err) } })
            );
            return;
          case 'findGuild':
            if (message.d?.guild && message.n)
              this.manager.findGuild(message.d.guild).then(
                (shard) => this.send({ r: message.r, d: { shard: shard ? shard.id : undefined } }),
                (err) => this.send({ r: message.r, d: { _error: makePlainError(err) } })
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
    this._awaitedPromises.clear();

    if (respawn) this.manager.spawn(this.id);
  }

  sendAndRecieve<T = any>(type: string, data: any): Promise<ManagerResponseMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!this.process) return reject(new Error('Shard is not running.'));

      const nonce = nanoid();
      this._awaitedPromises.set(nonce, { resolve, reject });
      this.process!.send({
        t: type,
        n: nonce,
        d: data
      });
    });
  }
}
