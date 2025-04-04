import config from 'config';

import * as logger from './logger';
import ShardManager from './manager';
import BotListPosterModule from './modules/botlist';
import MetricsModule from './modules/metrics';
import ShardUtilModule from './modules/shardutil';

const manager = new ShardManager(config.get('sharding'));
manager.on('shardSpawn', (shard) => logger.info(`Shard ${shard.id} spawned process ${shard.process.pid}`));
manager.on('disconnect', (shard, e) => logger.warn(`Shard ${shard.id} disconnected.`, e));
manager.on('reconnecting', (shard, m) => logger.warn(`Shard ${shard.id} reconnecting...`, m));
manager.on('ready', (shard, msg) => logger.info(`Shard ${shard.id} ready with ${msg.d?._guilds ?? '<unknown>'} guilds.`));
manager.on('shardError', (shard, e) => logger.error(`Shard ${shard.id} encountered an error`, e));

manager.loadModules(BotListPosterModule, ShardUtilModule, MetricsModule);
process.on('unhandledRejection', (r) => logger.error('Unhandled exception:', r));

(async () => {
  logger.info('Starting to spawn...');
  await manager.spawnAllWithConcurrency();
  logger.info(
    `Spawned ${manager.shards.size} shards in ${Array.from(manager.shards.values())
      .map((shard) => shard.guildCount)
      .reduce((acc, val) => acc + val, 0)} guilds.`
  );
  // PM2 graceful start/shutdown
  if (process.send) process.send('ready');
})();
