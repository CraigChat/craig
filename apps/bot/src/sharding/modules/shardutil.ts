import * as logger from '../logger';
import ShardManagerModule from '../module';

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
        const res = await onShard.eval(msg.d.script);
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
    this.registerCommand('getCounts', async (shard, msg, respond) => {
      logger.debug(`Shard ${shard.id}: Getting counts`);
      const guildResponses = await this.manager.fetchClientValues('bot.guilds.size');
      const guilds = guildResponses.reduce((acc, val) => acc + (val ?? 0), 0);
      const recResponses = await this.manager.fetchClientValues('modules.get("recorder").recordings.size');
      const recordings = recResponses.reduce((acc, val) => acc + (val ?? 0), 0);
      return respond({ guilds, recordings });
    });
    this.registerCommand('getShardInfo', async (shard, msg, respond) => {
      logger.debug(`Shard ${shard.id}: Getting shard info`);
      const res = await this.manager.broadcastEval(`
        let res = {
          id: this.shard ? this.shard.id : parseInt(process.env.SHARD_ID),
          status: this.shard.status,
          guilds: this.bot.guilds.size,
          latency: Number.isFinite(this.shard.latency) ? this.shard.latency : -1,
          uptime: process.uptime(),
          recordings: this.modules.get("recorder").recordings.size
        };
        res
      `);
      return respond({ res });
    });
  }

  unload() {
    this.unregisterAllCommands();
  }
}
