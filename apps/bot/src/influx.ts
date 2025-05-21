import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { captureException, withScope } from '@sentry/node';
import config from 'config';
import { CronJob } from 'cron';
import { DexareClient } from 'dexare';
import { hostname } from 'os';

import { client as dexareClient, CraigBotConfig } from './bot';
import type MetricsModule from './modules/metrics';
import type RecorderModule from './modules/recorder';

const influxOpts: any = config.has('influx') ? config.get('influx') : null;
export const client: InfluxDB | null = influxOpts && influxOpts.url ? new InfluxDB({ url: influxOpts.url, token: influxOpts.token }) : null;

export const cron = new CronJob('*/5 * * * *', collect, null, false, 'America/New_York');

export let activeUsers: string[] = [];
export let activeGuilds: string[] = [];
export const commandCounts = new Map<string, { users: string[]; used: number }>();
export let commandsRan = 0;
export let recordingsStarted = 0;
export let autorecordingsStarted = 0;

export let pointQueue: Point[] = [];

function getMetricsModule() {
  return dexareClient.modules.get('metrics') as any as MetricsModule;
}

export function onCommandRun(userID: string, commandName: string, guildID?: string) {
  getMetricsModule().onCommandRan(commandName);
  if (!influxOpts || !influxOpts.url || !client) return;
  const commandCount = commandCounts.get(commandName) || { users: [], used: 0 };

  if (!commandCount.users.includes(userID)) commandCount.users.push(userID);

  commandCount.used++;
  commandsRan++;

  if (!activeUsers.includes(userID)) activeUsers.push(userID);
  if (guildID && !activeGuilds.includes(guildID)) activeGuilds.push(guildID);

  commandCounts.set(commandName, commandCount);
}

export function onRecordingStart(userID: string, guildID: string, auto = false) {
  getMetricsModule().onRecordingStart(auto);
  if (!influxOpts || !influxOpts.url || !client) return;
  recordingsStarted++;
  if (!activeUsers.includes(userID)) activeUsers.push(userID);
  if (!activeGuilds.includes(guildID)) activeGuilds.push(guildID);
  if (auto) autorecordingsStarted++;
}

export async function onRecordingEnd(
  userID: string,
  guildID: string,
  started: Date,
  duration: number,
  errored = false
) {
  if (!influxOpts || !influxOpts.url || !client) return;
  if (!activeUsers.includes(userID)) activeUsers.push(userID);
  if (!activeGuilds.includes(guildID)) activeGuilds.push(guildID);

  // Push this to queue
  pointQueue.push(
    new Point('recording')
      .tag('server', influxOpts.server || hostname())
      .tag('bot', influxOpts.bot || 'craig')
      .tag('shard', String(dexareClient.shard?.id ?? process.env.SHARD_ID))
      .tag('guildId', guildID)
      .tag('userId', userID)
      .tag('errored', errored ? 'true' : 'false')
      .intField('duration', duration)
      .timestamp(started)
  );

  // Flush queue
  try {
    const writeApi = client!.getWriteApi(influxOpts.org, influxOpts.bucket, 's');
    writeApi.writePoints(pointQueue);
    await writeApi.close();

    pointQueue = [];
  } catch (e) {
    withScope((scope) => {
      scope.clear();
      captureException(e);
    });
    console.error('Error writing points to Influx.', e);
  }
}

async function collect() {
  if (!influxOpts || !influxOpts.url || !client) return;
  const timestamp = cron.lastDate();

  const writeApi = client!.getWriteApi(influxOpts.org, influxOpts.bucket, 's');
  const recorder = dexareClient.modules.get('recorder') as any as RecorderModule<DexareClient<CraigBotConfig>>;

  // Update active guilds with guilds currently recording
  if (recorder) activeGuilds = [...new Set([...Object.keys(recorder.recordings), ...activeGuilds])];

  const points = [
    new Point('craig_stats')
      .tag('server', influxOpts.server || hostname())
      .tag('bot', influxOpts.bot || 'craig')
      .tag('shard', String(dexareClient.shard?.id ?? process.env.SHARD_ID))
      .intField('recordingsStarted', recordingsStarted)
      .intField('autorecordingsStarted', autorecordingsStarted)
      .intField('activeRecordings', recorder ? recorder.recordings.size : 0)
      .intField('commandsRan', commandsRan)
      .intField('activeUsers', activeUsers.length)
      .intField('activeGuilds', activeGuilds.length)
      .timestamp(timestamp)
  ];

  // Insert command counts
  commandCounts.forEach((counts, name) =>
    points.push(
      new Point('command_usage')
        .tag('server', influxOpts.server || hostname())
        .tag('bot', influxOpts.bot || 'craig')
        .tag('shard', String(dexareClient.shard?.id ?? process.env.SHARD_ID))
        .tag('command', name)
        .intField('used', counts.used)
        .intField('usedUnique', counts.users.length)
        .timestamp(timestamp)
    )
  );

  // Insert shard data
  const serverMap: { [key: string]: number } = {};
  const unavailableServerMap: { [key: string]: number } = {};
  dexareClient.bot.guilds.map((guild) => {
    const shardID = String(guild.shard.id);
    if (serverMap[shardID]) serverMap[shardID] += 1;
    else serverMap[shardID] = 1;
  });
  dexareClient.bot.unavailableGuilds.map(() => {
    const shardID = process.env.SHARD_ID!;
    if (unavailableServerMap[shardID]) unavailableServerMap[shardID] += 1;
    else unavailableServerMap[shardID] = 1;
  });
  dexareClient.bot.shards.map((shard) =>
    points.push(
      new Point('shards')
        .tag('server', influxOpts.server || hostname())
        .tag('bot', influxOpts.bot || 'craig')
        .tag('shard', String(shard.id))
        .intField('ms', isFinite(shard.latency) ? shard.latency : 0)
        .stringField('status', shard.status || 'unknown')
        .intField('guilds', serverMap[String(shard.id)] ?? 0)
        .intField('unavailableGuilds', unavailableServerMap[String(shard.id)] ?? 0)
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
