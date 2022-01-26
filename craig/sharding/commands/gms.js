// This deletes the guild from teh gms table, not important atm
// guildDelete = function(guild) {
//   guildLeave(guild);
//   delete guildMembershipStatus[guild.id];
//   cdb.deleteGuild(guild.id);
// }

module.exports = {
  init: (manager) => {
    manager.commands.set("guildDelete", function(shard, msg) {
      // guildDelete({id:msg.g});
    });
  }
}