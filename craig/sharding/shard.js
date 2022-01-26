const childProcess = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const Util = require('./util');

class Shard extends EventEmitter {
  constructor(manager, id) {
    super();
    this.id = id;
    this.manager = manager;
    this.env = Object.assign({}, process.env, {
      SHARD_ID: this.id,
      SHARD_COUNT: this.manager.shardCount,
      CLIENT_TOKEN: this.manager.token,
    });

    this.ready = false;
    this.guildCount = 0;
    this.status = 'IDLE';
    this.lastActivity = 0;

    this._evals = new Map();
    this._fetches = new Map();
    this._exitListener = this._handleExit.bind(this, undefined);
    this.process = null;
  }

  spawn(args = this.manager.args, execArgv = this.manager.execArgv) {
    this.process = childProcess.fork(path.resolve(this.manager.file), args, {
      env: this.env, execArgv,
    })
      .on('exit', this._exitListener)
      .on('message', this._handleMessage.bind(this));

    this.emit('spawn', this.process);
    this.manager.emit('shardSpawn', this);

    return new Promise((resolve, reject) => {
      this.once('ready', resolve);
      this.once('disconnect', () => reject(new Error(`Shard ${this.id}'s Client disconnected before becoming ready.`)));
      this.once('death', () => reject(new Error(`Shard ${this.id}'s process exited before its Client became ready.`)));
      setTimeout(() => reject(new Error(`Shard ${this.id}'s Client took too long to become ready.`)), 30000);
    }).then(() => this.process);
  }

  respawn(delay = 500) {
    this.kill();
    if (delay > 0) return Util.delayFor(delay).then(() => this.spawn());
    return this.spawn();
  }

  kill() {
    this.process.removeListener('exit', this._exitListener);
    this.process.kill();
    this._handleExit(false);
  }

  send(message) {
    return new Promise((resolve, reject) => {
      this.process.send(message, err => {
        if (err) reject(err); else resolve(this);
      });
    });
  }

  fetchClientValue(prop) {
    if (this._fetches.has(prop)) return this._fetches.get(prop);

    const promise = new Promise((resolve, reject) => {
      const listener = message => {
        if (!message || message._fetchProp !== prop) return;
        this.process.removeListener('message', listener);
        this._fetches.delete(prop);
        resolve(message._result);
      };
      this.process.on('message', listener);

      this.send({ _fetchProp: prop }).catch(err => {
        this.process.removeListener('message', listener);
        this._fetches.delete(prop);
        reject(err);
      });
    });

    this._fetches.set(prop, promise);
    return promise;
  }

  eval(script) {
    if (this._evals.has(script)) return this._evals.get(script);

    const promise = new Promise((resolve, reject) => {
      const listener = message => {
        if (!message || message._eval !== script) return;
        this.process.removeListener('message', listener);
        this._evals.delete(script);
        if (!message._error) resolve(message._result); else reject(Util.makeError(message._error));
      };
      this.process.on('message', listener);

      this.send({ _eval: script }).catch(err => {
        this.process.removeListener('message', listener);
        this._evals.delete(script);
        reject(err);
      });
    });

    this._evals.set(script, promise);
    return promise;
  }

  _handleMessage(message) {
    if (message) {
      const now = Date.now();
      if (now > this.lastActivity) this.lastActivity = now;

      if (message.managerEvent) {
        if (message.status) this.status = message.status;
        if (message.guildCount) this.guildCount = message.guildCount;
        switch (message.managerEvent) {
          case 'ready':
            this.ready = true;
            this.emit('ready', message);
            this.manager.emit('ready', this, message);
            return;
          case 'disconnect':
            this.ready = false;
            this.emit('disconnect', message.error);
            this.manager.emit('disconnect', this, message.error);
            return;
          case 'reconnecting':
            this.ready = false;
            this.emit('reconnecting', message.msg);
            this.manager.emit('reconnecting', this, message.msg);
            return;
          case 'resumed':
            this.ready = false;
            this.emit('resumed');
            this.manager.emit('resumed', this);
            return;
          case 'error':
            this.ready = false;
            this.emit('shardError', message.error);
            this.manager.emit('shardError', this, message.error);
            return;
          case 'ping':
            return;
        }
      }

      // Shard is requesting a property fetch
      if (message._sFetchProp) {
        this.manager.fetchClientValues(message._sFetchProp).then(
          results => this.send({ _sFetchProp: message._sFetchProp, _result: results }),
          err => this.send({ _sFetchProp: message._sFetchProp, _error: Util.makePlainError(err) })
        );
        return;
      }

      // Shard is requesting an eval broadcast
      if (message._sEval) {
        this.manager.broadcastEval(message._sEval).then(
          results => this.send({ _sEval: message._sEval, _result: results }),
          err => this.send({ _sEval: message._sEval, _error: Util.makePlainError(err) })
        );
        return;
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
  _handleExit(respawn = this.manager.respawn) {
    this.emit('death', this.process);

    this.process = null;
    this._evals.clear();
    this._fetches.clear();

    if (respawn) this.manager.spawn(this.id);
  }
}

module.exports = Shard;