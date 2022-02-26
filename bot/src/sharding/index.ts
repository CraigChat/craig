import * as logger from './logger';
import ShardManager from './manager';
import config from 'config';
import BotListPosterModule from './modules/botlist';

const manager = new ShardManager(config.get('sharding'));
manager.on('shardSpawn', (shard) => logger.info(`Shard ${shard.id} spawned process ${shard.process.pid}`));
manager.on('disconnect', (shard, e) => logger.warn(`Shard ${shard.id} disconnected.`, e));
manager.on('reconnecting', (shard, m) => logger.warn(`Shard ${shard.id} reconnecting...`, m));
manager.on('ready', (shard, msg) => logger.info(`Shard ${shard.id} ready with ${msg.guildCount} guilds.`));
manager.on('shardError', (shard, e) => logger.error(`Shard ${shard.id} encountered an error`, e));

manager.loadModules(BotListPosterModule);
process.on('unhandledRejection', (r) => logger.error('Unhandled exception:', r));

(async () => {
  logger.info('Starting to spawn...');
  await manager.spawnAll();
  logger.info(`Spawned ${manager.shards.size} shards.`);
  // PM2 graceful start/shutdown
  if (process.send) process.send('ready');
})();
