import { Poster } from 'dbots';
import ShardManagerModule from '../module';
import config from 'config';
import * as logger from '../logger';
import { CronJob } from 'cron';

export default class BotListPosterModule extends ShardManagerModule {
  poster: Poster;
  cron: CronJob;

  constructor(client: any) {
    super(client, {
      name: 'botlist',
      description: 'Bot list poster'
    });

    this.poster = new Poster({
      clientID: config.get('dexare.applicationID'),
      apiKeys: config.has('botlist') ? config.get('botlist') : {}
    });
    this.cron = new CronJob('0 * * * *', this.onCron.bind(this), null, false, 'America/New_York');
    this.filePath = __filename;
  }

  load() {
    if (!config.has('botlist')) return void logger.info('Botlist is not configured, skipping...');
    this.cron.start();
    logger.info(`Botlist configured with ${Object.keys(config.get('botlist')).length} key(s).`);
  }

  async onCron() {
    try {
      const responses = await this.manager.fetchClientValues('bot.guilds.size');
      const serverCount = responses.reduce((acc, val) => acc + (val ?? 0), 0);
      await this.poster.postManual('all', { serverCount });
    } catch (error) {
      logger.error('Failed to post stats', error);
    }
  }

  unload() {
    this.cron.stop();
    this.unregisterAllCommands();
  }
}
