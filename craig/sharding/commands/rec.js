const activeRecordings = {};

// An event emitter for whenever we start or stop any recording
class RecordingEvent extends EventEmitter {}
const recordingEvents = new RecordingEvent();

// Make a pseudo-recording sufficient for stats and keeping track but little else
function pseudoRecording(gid, cid, id, accessKey, size) {
    var rec = {
        id: id,
        accessKey: accessKey,
        connection: {
            channel: {
                id: cid,
                members: {
                    size: size
                }
            },
            disconnect: function() {
                recordingEvents.emit("stop", rec);
                delete activeRecordings[gid][cid];
                if (Object.keys(activeRecordings[gid]).length === 0)
                    delete activeRecordings[gid];
            }
        }
    };
    return rec;
}

module.exports = {
  activeRecordings, recordingEvents,
  init: (manager) => {
    manager.commands.set("startRecording", function(shard, msg) {
      if (!(msg.g in activeRecordings)) activeRecordings[msg.g] = {};
      var rec = activeRecordings[msg.g][msg.c] = pseudoRecording(msg.g, msg.c, msg.id, msg.accessKey, msg.size, manager);
      recordingEvents.emit("start", rec);
    });
    manager.commands.set("stopRecording", function(shard, msg) {
      try {
          activeRecordings[msg.g][msg.c].connection.disconnect();
      } catch (ex) {}
    });
    manager.commands.set("requestActiveRecordings", function(shard, msg) {
      var nar = {};
      for (var gid in activeRecordings) {
          var g = activeRecordings[gid];
          var ng = nar[gid] = {};
          for (var cid in g) {
              var c = g[cid];
              var size = 1;
              try {
                  size = c.connection.channel.members.size;
              } catch (ex) {}
              var nc = ng[cid] = {
                  id: c.id,
                  accessKey: c.accessKey,
                  size: size
              };
          }
      }
      shard.send({
        t: "activeRecordings",
        activeRecordings: nar
      });
    });
  }
}