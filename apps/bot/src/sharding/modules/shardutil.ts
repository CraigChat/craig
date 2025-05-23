import { CronJob } from 'cron';

import { wait } from '../../util';
import * as logger from '../logger';
import ShardManagerModule from '../module';

export default class ShardUtilModule extends ShardManagerModule {
  cron: CronJob;
  checkingRWA = false;

  constructor(client: any) {
    super(client, {
      name: 'shardutil',
      description: 'Shard utility'
    });

    this.filePath = __filename;
    this.cron = new CronJob('*/10 * * * *', this.onCron.bind(this), null, false, 'America/New_York');
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
      return respond({ ok: true });
    });
    this.registerCommand('checkMaintenance', async (shard) => {
      logger.info(`Shard ${shard.id}: Told shards to check maintenance`);
      await this.manager.broadcastEval('this.modules.get("recorder").checkForMaintenance()');
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
      const res: any[] = [];
      await Promise.all(
        Array.from(this.manager.shards.values()).map(async (shard) => {
          const shardRes = await Promise.race([
            shard.eval(
              `
                let res = {
                  id: this.shard ? this.shard.id : parseInt(process.env.SHARD_ID),
                  status: this.shard.status,
                  guilds: this.bot.guilds.size,
                  latency: Number.isFinite(this.shard.latency) ? this.shard.latency : -1,
                  uptime: process.uptime(),
                  recordings: this.modules.get("recorder").recordings.size
                };
                res
              `
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => null);
          res.push({
            status: shard.status,
            ...(shardRes ?? {}),
            id: shard.id,
            respawnWhenAvailable: shard.respawnWhenAvailable,
            lastActivity: shard.lastActivity
          });
        })
      );

      return respond({ res, spawned: this.manager.shards.size, total: this.manager.options.shardCount });
    });
    this.registerCommand('setRWA', async (shard, msg, respond) => {
      if (msg.d.id === 'all') {
        logger.info(`Shard ${shard.id}: Setting RWA state for all shards to ${msg.d.value}`);
        for (const shard of this.manager.shards.values()) shard.respawnWhenAvailable = msg.d.value;
        return respond({ ok: true });
      }
      logger.info(`Shard ${shard.id}: Setting RWA state on shard ${msg.d.id} to ${msg.d.value}`);
      const onShard = this.manager.shards.get(msg.d.id);
      if (!onShard) return respond({ result: null, error: 'Shard not found' });
      if (typeof msg.d.value !== 'boolean') return respond({ result: null, error: 'value not a boolean' });
      onShard.respawnWhenAvailable = msg.d.value;
      return respond({ ok: true });
    });
    this.registerCommand('setStatus', async (shard, msg, respond) => {
      logger.info(`Shard ${shard.id}: Setting status`, msg.d);
      for (const shard of this.manager.shards.values())
        shard.process?.send({
          t: 'setStatus',
          d: msg.d
        });
      return respond({ ok: true });
    });
    this.cron.start();
  }

  unload() {
    this.cron.stop();
    this.unregisterAllCommands();
  }

  async onCron() {
    if (this.checkingRWA) return;
    this.checkingRWA = true;
    try {
      for (const shard of this.manager.shards.values()) {
        if (shard.respawnWhenAvailable) {
          const recordings = await shard.eval('this.modules.get("recorder").recordings.size').catch(() => null);
          if (recordings === 0) {
            logger.info(`Shard ${shard.id}: Respawning since RWA is set`);
            shard.respawnWhenAvailable = false;
            const ok = await shard
              .respawnWithRetry()
              .then(() => true)
              .catch(() => false);
            if (ok) logger.info(`Shard ${shard.id}: Respawned with RWA`);
            else logger.info(`Shard ${shard.id}: Failed to respawn with RWA`);
            await wait(1000);
          } else if (recordings === null) logger.warn(`Shard ${shard.id}: Could not fetch recordings size for RWA check!`);
        }
      }
    } catch (error) {
      logger.error('Failed to check RWA', error);
    }
    this.checkingRWA = false;
  }
}
