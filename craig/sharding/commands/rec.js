const activeRecordings = new Map();

module.exports = {
  activeRecordings,
  init: (manager) => {
    manager.commands.set("startRecording", function(shard, msg) {
      activeRecordings.set(`${msg.g}:${msg.c}`, msg.r);
    });
    manager.commands.set("stopRecording", function(shard, msg) {
      activeRecordings.delete(`${msg.g}:${msg.c}`);
    });
    manager.commands.set("requestActiveRecordings", function(shard, msg) {
      shard.send({
        t: "activeRecordings",
        activeRecordings: Array.from(activeRecordings.values()).filter((ar) => msg.guilds.includes(ar.guild))
      });
    });
  }
}