let banned = {};

// Functions to ban/unban
function banLocal(id, user) {
  banned[id] = user;
  if (cc.master)
      cdb.dbRun(banStmt, {id:id, name:user});
}

function unbanLocal(id) {
    delete banned[id];
    if (cc.master)
        cdb.dbRun(unbanStmt, {id});
}

module.exports = {
  banned,
  init: (manager) => {
    manager.commands.set("ban", function(shard, msg) {
      banLocal(msg.i, msg.u);
      manager.broadcast(msg, shard.id);
    });
    manager.commands.set("unban", function(shard, msg) {
      unbanLocal(msg.i);
      manager.broadcast(msg, shard.id);
    });
    manager.on("shardSpawn", (shard) => {
      for (var id in banned)
          shard.send({t:"ban",i:id,u:banned[id]});
    });
  }
}