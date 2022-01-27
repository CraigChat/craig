const Shard = require('./shard');
const EventEmitter = require('events');
const Util = require('./util');

class ShardManager extends EventEmitter {
  constructor(filePath, shardCount, { respawn = true, args = [], execArgv = [], readyTimeout = 30000 } = {}) {
    super();
    this.file = filePath;
    this.shardCount = shardCount;
    this.readyTimeout = readyTimeout;
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

  async findGuild(guildID) {
    for (const shard of this.shards.values()) {
      try {
        let res = await shard.eval(`this.guilds.has('${guildID}')`);
        if (res) return shard;
      } catch (e) {}
    }
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
            await shard.respawn(0);
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
      if (!shard.process) console.error('[master]', `Shard ${shard.id} does not have a process, it may be restarting.`);
      else if (shard.id !== excludedShard) promises.push(shard.send(message));
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
    if (this.shards.size !== this.shardCount) return Promise.reject(new Error('Still spawning shards.'));
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.fetchClientValue(prop));
    return Promise.all(promises);
  }

  async respawnAll(delay = 500, respawnDelay = 5000) {
    for (const shard of this.shards.values()) {
      let retries = 0;
      while (retries < 5) {
        console.log('[master]', `Respawning shard ${shard.id}... (attempt ${retries + 1})`);
        try {
          retries++;
          await shard.respawn(respawnDelay);
          break;
        } catch (e) {
          console.error('[master]', `Failed to respawn shard ${shard.id}`, e)
        }
        await Util.delayFor(delay);
      }
    }
  }
}

module.exports = ShardManager;