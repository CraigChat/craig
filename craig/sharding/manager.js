const Shard = require('./shard');
const EventEmitter = require('events');
const Util = require('./util');

class ShardManager extends EventEmitter {
  constructor(filePath, shardCount, { respawn = true, args = [], execArgv = [] } = {}) {
    super();
    this.file = filePath;
    this.shardCount = shardCount;
    this.respawn = respawn;
    this.args = args || [];
    this.execArgv = execArgv || [];
    this.shards = new Map();
    this.commands = new Map();
  }

  _processCommand(shard, msg) {
    if (!this.commands.has(msg.t)) return;
    this.commands.get(msg.t)(shard, msg);
  }

  spawn(id) {
    const shard = new Shard(this, id);
    this.shards.set(id, shard);
    this.emit('launch', shard);
    return shard.spawn();
  }

  async spawnAll(delay = 500) {
    while (this.shards.size < this.shardCount) {
      const currentId = this.shards.size;
      let retries = 0;
      while (retries < 5) {
        console.log('[master]', `Spawning shard ${currentId}... (attempt ${retries + 1})`);
        try {
          retries++;
          if (this.shards.has(currentId)) {
            const shard = this.shards.get(currentId);
            await shard.respawn(delay);
          } else await this.spawn(currentId);
          break;
        } catch (e) {
          console.error('[master]', `Failed to spawn shard ${currentId}`, e)
        }
        await Util.delayFor(delay);
      }
    }
  }

  broadcast(message, excludedShard = null) {
    const promises = [];
    for (const shard of this.shards.values()) {
      if (shard.id !== excludedShard) promises.push(shard.send(message));
    }
    return Promise.all(promises);
  }

  broadcastEval(script) {
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.eval(script));
    return Promise.all(promises);
  }

  fetchClientValues(prop) {
    if (this.shards.size === 0) return Promise.reject(new Error('No shards have been spawned.'));
    if (this.shards.size !== this.totalShards) return Promise.reject(new Error('Still spawning shards.'));
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.fetchClientValue(prop));
    return Promise.all(promises);
  }

  respawnAll(shardDelay = 5000, respawnDelay = 500, waitForReady = true, currentShardIndex = 0) {
    let s = 0;
    const shard = this.shards.get(currentShardIndex);
    const promises = [shard.respawn(respawnDelay, waitForReady)];
    if (++s < this.shards.size && shardDelay > 0) promises.push(Util.delayFor(shardDelay));
    return Promise.all(promises).then(() => {
      if (++currentShardIndex === this.shards.size) return this.shards;
      return this.respawnAll(shardDelay, respawnDelay, waitForReady, currentShardIndex);
    });
  }
}

module.exports = ShardManager;