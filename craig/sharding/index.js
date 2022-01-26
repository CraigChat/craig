const https = require("https");
const fs = require("fs");
const ShardManager = require('./manager');
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const rec = require('./commands/rec');

const manager = new ShardManager('./craig.js', config.sharding.count, {
  readyTimeout: config.sharding.readyTimeout || 30000
});
manager.on("message", (shard, msg) => {
  if (typeof msg !== "object") return;

  if (msg.t === "managerEval") {
    try {
      const r = eval(msg.cmd);
      shard.send({_mEval: msg.cmd, _result: r})
    } catch (e) {
      shard.send({_mEval: msg.cmd, _result: null, _error: e})
    }
    return;
  }

  let cmd = manager.commands.get(msg.t);
  if (cmd) cmd(shard, msg);
});
manager.on('shardSpawn', (shard) => console.error(`[Shard ${shard.id}] Spawned process ${shard.process.pid}`));
manager.on('disconnect', (shard, e) => console.error(`[Shard ${shard.id}] Disconnected.`, e));
manager.on('reconnecting', (shard, m) => console.error(`[Shard ${shard.id}] Reconnecting...`, m));
manager.on('ready', (shard, msg) => console.log(`[Shard ${shard.id}] Ready with ${msg.guildCount} guilds.`));
manager.on('shardError', (shard, e) => console.error(`[Shard ${shard.id}]`, e));

(async () => {
  console.log('Loading commands...');
  require('./commands/autorecord').init(manager);
  require('./commands/bans').init(manager);
  require('./commands/ctrl').init(manager);
  require('./commands/features').init(manager);
  require('./commands/gms').init(manager);
  rec.init(manager);
  console.log('Starting to spawn...');
  await manager.spawnAll();
  console.log(`Spawned ${manager.shards.size} shards.`);
})();

process.on('unhandledRejection', (r) => console.error('Unhandled exception:', r));

// Stats updating
async function onStatsUpdate() {
  try {
    const shard = await manager.findGuild(config.stats.guild);
    if (!shard) return;
    let totalSize = 0;
    for (const ar of rec.activeRecordings.values()) {
      totalSize += ar.size - 1;
    }
    
    let topic = config.stats.topic + " Currently recording " + totalSize.toLocaleString() + " users in " + rec.activeRecordings.size.toLocaleString() + " voice channels.";
    shard.send({ t: "setTopic", v: topic });
  } catch (ex) {
    console.error('Failed to update stats!', ex);
  }
}

let statsInterval;
if (config.stats) statsInterval = setInterval(onInterval, 3600000);

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

let postInterval = setInterval(onInterval, 3600000);