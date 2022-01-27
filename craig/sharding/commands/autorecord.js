// Association of users with arrays autorecord guild+channels
var autoU2GC = {};

// Association guild -> channel -> users/triggers
var autoG2C2U = {};

// Remove a user's autorecord, for a specific channel or all channels
function removeAutorecordLocal(uid, gid, cid) {
  // Remove it in one direction
  if (uid in autoU2GC) {
      var gcs = autoU2GC[uid];
      for (var gci = 0; gci < gcs.length; gci++) {
          var gc = gcs[gci];
          if (gc.g !== gid) continue;
          if (cid && gc.c !== cid) continue;

          // Found one to remove
          gcs.splice(gci, 1);
          if (gcs.length === 0)
              delete autoU2GC[uid];
          gci--;
      }
  }

  // Then the other
  if (gid in autoG2C2U) {
      var c2u = autoG2C2U[gid];
      for (var ccid in c2u) {
          if (cid && ccid !== cid) continue;
          var us = c2u[ccid];
          for (var ui = 0; ui < us.length; ui++) {
              var u = us[ui];
              if (u.u !== uid) continue;

              // Found one to remove
              us.splice(ui, 1);
              if (us.length === 0) {
                  delete c2u[ccid];
                  if (Object.keys(c2u).length === 0)
                      delete autoG2C2U[gid];
              }
              ui--;
          }
      }
  }
}

// Add an autorecord for a user
function addAutorecordLocal(uid, gid, cid, tids, min) {
  removeAutorecordLocal(uid, gid, cid);
  var i = {u:uid, g:gid, c:cid, min:1};
  var dbtids = [];
  if (tids) {
      i.t = tids;
      for (var tid in tids)
          dbtids.push(tid);
  }
  if (typeof min !== "undefined" && min > 0)
      i.min = min;
  if (!(uid in autoU2GC)) autoU2GC[uid] = [];
  if (!(gid in autoG2C2U)) autoG2C2U[gid] = {};
  if (!(cid in autoG2C2U[gid])) autoG2C2U[gid][cid] = [];
  autoU2GC[uid].push(i);
  autoG2C2U[gid][cid].push(i);
}

module.exports = {
  autoU2GC, autoG2C2U,
  init: (manager) => {
    manager.commands.set("addAutorecord", function(shard, msg) {
      addAutorecordLocal(msg.u, msg.g, msg.c, msg.tids?msg.tids:undefined, msg.min?msg.min:undefined);
      manager.broadcast(msg, shard.id);
    });
    manager.commands.set("removeAutorecord", function(shard, msg) {
      removeAutorecordLocal(msg.u, msg.g, msg.c);
      manager.broadcast(msg, shard.id);
    });
    manager.on("ready", (shard) => {
      for (var uid in autoU2GC) {
        var gcs = autoU2GC[uid];
        gcs.forEach((gc) => {
          shard.send({
            t:"addAutorecord",
            u:uid,
            g:gc.g, c:gc.c, tids:(gc.t?gc.t:false), min:(gc.min?gc.min:1)
          });
        });
      }
    });
  }
}