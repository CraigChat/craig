// Non-reward-based features
var otherFeatures = {};

module.exports = {
  otherFeatures,
  init: (manager) => {
    manager.commands.set("fetchRewards", function(shard, msg) {
      manager.broadcast(msg, shard.id);
    });
    manager.commands.set("fetchedRewards", function(shard, msg) {
      manager.broadcast(msg, shard.id);
    });
    manager.commands.set("ecEnable", function(shard, msg) {
      otherFeatures[msg.u] = {ennuicastr: true};
      manager.broadcast(msg, shard.id);
    });
    manager.commands.set("ecDisable", function(shard, msg) {
      delete otherFeatures[msg.u];
      manager.broadcast(msg, shard.id);
    });
    manager.on("shardSpawn", (shard) => {
      for (var uid in otherFeatures) {
          if (otherFeatures[uid].ennuicastr)
              shard.send({t:"ecEnable", u:uid});
      }
    });
  }
}