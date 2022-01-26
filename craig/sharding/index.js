const https = require("https");
const ShardManager = require('./manager');
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

const manager = new ShardManager('./craig.js', config.sharding.count);
manager.on("message", (shard, msg) => {
  if (typeof msg !== "object") return;
  let cmd = manager.commands.get(msg.t);
  if (cmd) cmd(shard, msg);
});
manager.on('shardSpawn', (shard) => console.error(`[Shard ${shard.id}] Spawned process ${shard.process.id}`));
manager.on('disconnect', (shard, e) => console.error(`[Shard ${shard.id}] Disconnected.`, e));
manager.on('reconnecting', (shard, m) => console.error(`[Shard ${shard.id}] Reconnecting...`, m));
manager.on('ready', (shard) => console.log(`[Shard ${shard.id}] Ready.`));
manager.on('error', (shard, e) => console.log(`[Shard ${shard.id}]`, e));

(async () => {
  console.log('Loading commands...');
  require('./commands/autorecord').init(manager);
  require('./commands/bans').init(manager);
  require('./commands/ctrl').init(manager);
  require('./commands/features').init(manager);
  require('./commands/gms').init(manager);
  require('./commands/rec').init(manager);
  console.log('Starting to spawn...');
  await manager.spawnAll();
  console.log(`Spawned ${manager.shards.size} shards.`);
})();

// Guild count posting
let lastServerCount = 0;
async function onInterval() {
  if (config.discordbotstoken || config.botsdiscordpwtoken) return;
  try {
    const results = await manager.fetchClientValues("guilds.size");
    let size = 0;
    results.forEach((r) => { size += r; });
    postCount(size);
  } catch (ex) {
    console.error('Failed to get guild count!', ex);
  }
}

function postCount(count) {
  console.log(`Posting to botlists with ${count} servers (prev. ${lastServerCount})`);
  if (lastServerCount === size) return;
  lastServerCount = size;

  var domains = {discordbotstoken: "top.gg", botsdiscordpwtoken: "discord.bots.gg"};
  var payloads = {discordbotstoken: JSON.stringify({server_count: size}), botsdiscordpwtoken: JSON.stringify({guildCount: size})};
  for (var tname in domains) {
      var domain = domains[tname];
      var dtoken = config[tname];
      var postData = payloads[tname];
      if (!dtoken) continue;

      try {
          var req = https.request({
              hostname: domain,
              path: "/api/bots/" + config.applicationID + "/stats",
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
                  "Content-Length": postData.length,
                  "Authorization": dtoken
              }
          }, () => {});
          req.write(postData);
          req.end();
      } catch(ex) {
        console.error(`Failed to post to ${domain}`, ex)
      }
  }
}

setInterval(onInterval, 3600000);