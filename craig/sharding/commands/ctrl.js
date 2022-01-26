module.exports = {
  activeRecordings, recordingEvents,
  init: (manager) => {
    manager.commands.set("gracefulRestart", async function(shard, msg) {
      console.log(`[Shard ${shard.id}] Triggered graceful restart`);
      await manager.respawnAll();
      console.log(`[Shard ${shard.id}] Gracefully restarted.`)
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