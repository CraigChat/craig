import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { CronJob } from 'cron';
import { hostname } from 'os';
import { captureException, withScope } from '@sentry/node';
import { client as dexareClient } from './bot';
import config from 'config';

const influxOpts: any = config.get('influx');
export const client: InfluxDB | null =
  influxOpts && influxOpts.url ? new InfluxDB({ url: influxOpts.url, token: influxOpts.token }) : null;

export const cron = new CronJob('*/5 * * * *', collect, null, false, 'America/New_York');

export let activeUsers: string[] = [];
export let activeGuilds: string[] = [];
export const commandCounts = new Map<string, { users: string[]; used: number }>();
export let commandsRan = 0;
export let recordingsStarted = 0;
export let autorecordingsStarted = 0;

export function onCommandRun(userID: string, commandName: string, guildID?: string) {
  const commandCount = commandCounts.get(commandName) || { users: [], used: 0 };

  if (!commandCount.users.includes(userID)) commandCount.users.push(userID);

  commandCount.used++;
  commandsRan++;

  if (!activeUsers.includes(userID)) activeUsers.push(userID);
  if (guildID && !activeGuilds.includes(guildID)) activeGuilds.push(guildID);

  commandCounts.set(commandName, commandCount);
}

export function onRecordingStart(userID: string, guildID: string, auto = false) {
  recordingsStarted++;
  if (!activeUsers.includes(userID)) activeUsers.push(userID);
  if (!activeGuilds.includes(guildID)) activeGuilds.push(guildID);
  if (auto) autorecordingsStarted++;
}

async function collect(timestamp = new Date()) {
  if (!influxOpts || !influxOpts.url) return;
  if (!timestamp) timestamp = cron.lastDate();

  const writeApi = client!.getWriteApi(influxOpts.org, influxOpts.bucket, 's');
  const points = [
    new Point('craig_stats')
      .tag('server', influxOpts.server || hostname())
      .tag('bot', influxOpts.bot || 'craig')
      .intField('recordingsStarted', recordingsStarted)
      .intField('autorecordingsStarted', autorecordingsStarted)
      .intField('commandsRan', commandsRan)
      .intField('activeUsers', activeUsers.length)
      .intField('activeGuilds', activeGuilds.length)
      .timestamp(timestamp || cron.lastDate())
  ];

  // Insert command counts
  commandCounts.forEach((counts, name) =>
    points.push(
      new Point('command_usage')
        .tag('server', influxOpts.server || hostname())
        .tag('bot', influxOpts.bot || 'craig')
        .tag('command', name)
        .intField('used', counts.used)
        .intField('usedUnique', counts.users.length)
        .timestamp(timestamp)
    )
  );

  // Insert shard data
  const serverMap: { [key: string]: number } = {};
  dexareClient.bot.guilds.map((guild) => {
    const shardID = String(guild.shard.id);
    if (serverMap[shardID]) serverMap[shardID] += 1;
    else serverMap[shardID] = 1;
  });
  dexareClient.bot.shards.map((shard) =>
    points.push(
      new Point('shards')
        .tag('server', influxOpts.server || hostname())
        .tag('bot', influxOpts.bot || 'craig')
        .tag('shard', String(shard.id))
        .intField('ms', isFinite(shard.latency) ? shard.latency : 0)
        .stringField('status', shard.status || 'unknown')
        .intField('guilds', serverMap[String(shard.id)])
        .timestamp(timestamp)
    )
  );

  // Send to influx
  try {
    writeApi.writePoints(points);
    await writeApi.close();
  } catch (e) {
    withScope((scope) => {
      scope.clear();
      scope.setExtra('date', timestamp || cron.lastDate());
      captureException(e);
    });
    console.error('Error sending stats to Influx.', e);
  }

  // Flush data for next cron run
  activeGuilds = [];
  activeUsers = [];
  commandsRan = 0;
  recordingsStarted = 0;
  autorecordingsStarted = 0;
  commandCounts.clear();
}
