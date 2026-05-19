import fetch from 'node-fetch';

import { getShardManagerEnvOptions } from '../config.js';
import { wait } from '../util.js';
import * as logger from './logger.js';
import ShardManager from './manager.js';
import ControlModule from './modules/control.js';
import MetricsModule from './modules/metrics.js';
import ShardUtilModule from './modules/shardutil.js';

const LOW_SESSION_START_REMAINING_RATIO = 0.1;
const LOW_RESET_AFTER_MS = 60 * 1000;
const RESET_WAIT_BUFFER_MS = 1000;

interface GatewayBotResponse {
  url: string;
  shards: number;
  session_start_limit: {
    total: number;
    remaining: number;
    reset_after: number;
    max_concurrency: number;
  };
}

async function fetchGatewayBot(token: string): Promise<GatewayBotResponse> {
  const response = await fetch('https://discord.com/api/v10/gateway/bot', {
    headers: {
      Authorization: `Bot ${token}`
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch gateway bot info: ${response.status} ${await response.text()}`);
  return (await response.json()) as GatewayBotResponse;
}

function formatDuration(ms: number) {
  return `${Math.ceil(ms / 1000)}s`;
}

async function waitForSessionStartLimit(token: string, requiredSessions: number, gatewayBot: GatewayBotResponse) {
  while (true) {
    const {
      session_start_limit: { total, remaining, reset_after }
    } = gatewayBot;
    const lowRemainingThreshold = Math.ceil(total * LOW_SESSION_START_REMAINING_RATIO);
    const hasLowRemaining = remaining < requiredSessions || (remaining < total && remaining <= lowRemainingThreshold);
    const hasLowResetAfter = reset_after > 0 && reset_after <= LOW_RESET_AFTER_MS;

    if (!hasLowRemaining && !hasLowResetAfter) return;

    if (hasLowRemaining) {
      logger.warn(
        `Discord session start limit is low (${remaining}/${total} remaining; need ${requiredSessions}). Waiting ${formatDuration(
          reset_after
        )} for the limit to reset before spawning shards.`
      );
    }
    if (hasLowResetAfter) {
      logger.warn(`Discord session start limit resets soon (${formatDuration(reset_after)}). Waiting for reset before spawning shards.`);
    }

    await wait(reset_after + RESET_WAIT_BUFFER_MS);
    gatewayBot = await fetchGatewayBot(token);
  }
}

process.on('unhandledRejection', (r) => logger.error('Unhandled exception:', r));

(async function main() {
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');
  if (!process.env.BOT_APPLICATION_ID) throw new Error('BOT_APPLICATION_ID is required.');

  const envOptions = getShardManagerEnvOptions();
  const gatewayBot = await fetchGatewayBot(process.env.BOT_TOKEN);
  const shardCount = envOptions.shardCount ?? gatewayBot.shards;
  if (shardCount < gatewayBot.shards)
    logger.warn(`The configured shard count (${shardCount}) is lower than Discord's recommended shard count (${gatewayBot.shards}).`);

  const maxConcurrency = gatewayBot.session_start_limit.max_concurrency || 1;
  const concurrency = Math.max(1, Math.min(envOptions.concurrency ?? maxConcurrency, maxConcurrency));
  const manager = new ShardManager({
    ...envOptions,
    token: process.env.BOT_TOKEN,
    applicationID: process.env.BOT_APPLICATION_ID,
    shardCount,
    concurrency
  });
  manager.on('shardSpawn', (shard) => logger.info(`Shard ${shard.id} spawned process ${shard.process.pid}`));
  manager.on('disconnect', (shard, e) => logger.warn(`Shard ${shard.id} disconnected.`, e));
  manager.on('reconnecting', (shard, m) => logger.warn(`Shard ${shard.id} reconnecting...`, m));
  manager.on('ready', (shard, msg) => logger.info(`Shard ${shard.id} ready with ${msg.d?._guilds ?? '<unknown>'} guilds.`));
  manager.on('shardError', (shard, e) => logger.error(`Shard ${shard.id} encountered an error`, e));

  await manager.loadModules(ShardUtilModule, MetricsModule, ControlModule);
  logger.info(
    `Gateway recommends ${gatewayBot.shards} shard(s), max concurrency ${maxConcurrency}; launching ${shardCount} shard(s) at concurrency ${concurrency}.`
  );
  logger.info('Fetching emojis...');
  await manager.syncEmojis();
  await waitForSessionStartLimit(process.env.BOT_TOKEN, shardCount, gatewayBot);
  logger.info('Starting to spawn...');
  // PM2 graceful start/shutdown
  if (process.send) process.send('ready');
  await manager.spawnAllWithConcurrency();
  logger.info(
    `Spawned ${manager.shards.size} shards in ${Array.from(manager.shards.values())
      .map((shard) => shard.guildCount)
      .reduce((acc, val) => acc + val, 0)} guilds.`
  );
})();
