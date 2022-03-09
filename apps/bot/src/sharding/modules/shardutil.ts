import ShardManagerModule from '../module';
import * as logger from '../logger';

export default class ShardUtilModule extends ShardManagerModule {
  constructor(client: any) {
    super(client, {
      name: 'shardutil',
      description: 'Shard utility commands'
    });

    this.filePath = __filename;
  }

  load() {
    this.registerCommand('gracefulRestart', async (shard) => {
      logger.info(`Shard ${shard.id}: Triggered graceful restart`);
      await this.manager.respawnAll();
      logger.info(`Shard ${shard.id}: Gracefully restarted.`);
    });
    this.registerCommand('shardEval', async (shard, msg, respond) => {
      const onShard = this.manager.shards.get(msg.d.id);
      if (!onShard) return respond({ result: null, error: 'Shard not found' });
      try {
        const res = await onShard.eval(msg.cmd);
        return respond({ result: res });
      } catch (ex) {
        return respond({ result: null, error: ex });
      }
    });
    this.registerCommand('restartMe', async (shard) => {
      logger.info(`Shard ${shard.id}: Triggered restart on itself`);
      await shard.respawn();
      logger.info(`Shard ${shard.id}: Restarted on command.`);
    });
    this.registerCommand('restartShard', async (shard, msg, respond) => {
      const onShard = this.manager.shards.get(msg.d.id);
      if (!onShard) return respond({ result: null, error: 'Shard not found' });
      logger.info(`Shard ${shard.id}: Triggered restart on shard ${onShard.id}`);
      await onShard.respawn();
      logger.info(`Shard ${shard.id}: Restarted shard ${onShard.id}.`);
    });
    this.registerCommand('checkMaintenance', async (shard) => {
      logger.info(`Shard ${shard.id}: Told shards to check maintenance`);
      await this.manager.broadcastEval('this.modules.get("recorder").checkMaintenance()');
    });
  }

  unload() {
    this.unregisterAllCommands();
  }
}
