const util = require("../util");

module.exports = {
  init: (manager) => {
    manager.commands.set("gracefulRestart", async function(shard, msg) {
      console.log(`[Shard ${shard.id}] Triggered graceful restart`);
      await manager.respawnAll();
      console.log(`[Shard ${shard.id}] Gracefully restarted.`)
    });
    manager.commands.set("toShardEval", async function(shard, msg) {
      const onShard = manager.shards.get(msg.id);
      if (!onShard) return shard.send({
        t: "toShardEvalRes",
        cmd: msg.cmd,
        _error: "That shard isnt in the manager."
      });
      try {
        const res = await onShard.eval(msg.cmd);
        return shard.send({
          t: "toShardEvalRes",
          cmd: msg.cmd,
          _result: res
        });
      } catch (ex) {
        return shard.send({
          t: "toShardEvalRes",
          cmd: msg.cmd,
          _error: util.makePlainError(ex)
        });
      }
    });
    manager.commands.set("restartThis", async function(shard, msg) {
      console.log(`[Shard ${shard.id}] Triggered restart on itself`);
      await shard.respawn();
      console.log(`[Shard ${shard.id}] Restarted from command.`)
    });
    manager.commands.set("restartOne", async function(shard, msg) {
      const onShard = manager.shards.get(msg.id);
      if (!onShard) return;
      console.log(`[Shard ${shard.id}] Triggered restart on shard ${onShard.id}`);
      await onShard.respawn();
      console.log(`[Shard ${shard.id}] Restarted shard ${onShard.id}.`)
    });
  }
}