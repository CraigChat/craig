import { CronJob } from 'cron';

import { wait } from '../../util.js';
import * as logger from '../logger.js';
import type ShardManager from '../manager.js';
import ShardManagerModule from '../module.js';

export default class ShardUtilModule extends ShardManagerModule {
  cron: CronJob;
  checkingRWA = false;

  constructor(manager: ShardManager) {
    super(manager, {
      name: 'shardutil',
      description: 'Shard utility'
    });
    this.cron = new CronJob('*/10 * * * *', this.onCron.bind(this), null, false, 'America/New_York');
  }

  load() {
    this.registerCommand('getCounts', async (shard, msg, respond) => {
      logger.debug(`Shard ${shard.id}: Getting counts`);
      const guildResponses = await this.manager.fetchClientValues('bot.guilds.size');
      const guilds = guildResponses.reduce<number>((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
      const recResponses = await this.manager.fetchClientValues('recorder.recordings.size');
      const recordings = recResponses.reduce<number>((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
      return respond({ guilds, recordings });
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
          const recordings = await shard.eval('this.recorder.recordings.size').catch(() => null);
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
