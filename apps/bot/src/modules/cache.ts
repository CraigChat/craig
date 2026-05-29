import { CronJob } from 'cron';

import type { CraigBot } from '../bot.js';
import { BotModule } from '../runtime.js';

export default class CacheModule extends BotModule {
  cron: CronJob;

  constructor(client: CraigBot) {
    super(client, {
      name: 'cache',
      description: 'Cache management'
    });

    this.cron = new CronJob('0 * * * *', this.onCron.bind(this), null, false, 'America/New_York');
  }

  load() {
    this.cron.start();
  }

  unload() {
    this.cron.stop();
  }

  onCron() {
    const keepUsers = new Set<string>();
    let membersRemoved = 0;
    let usersRemoved = 0;

    for (const [, guild] of this.client.bot.guilds) {
      for (const [userId] of guild.voiceStates) keepUsers.add(userId.toString());

      // Clean up guild members
      for (const [memberId] of guild.members) {
        if (memberId === this.client.bot.user.id) continue;
        if (!guild.voiceStates.has(memberId)) {
          guild.members.delete(memberId);
          membersRemoved++;
        } else keepUsers.add(memberId.toString());
      }

      // Clear guild attributes we dont care about
      guild.emojis = [];
      guild.stickers = [];
      guild.soundboardSounds.clear();
      guild.events.clear();
    }

    for (const [userId] of this.client.bot.users) {
      if (userId === this.client.bot.user.id) continue;
      if (!keepUsers.has(userId.toString())) {
        this.client.bot.users.delete(userId.toString());
        usersRemoved++;
      }
    }

    if (membersRemoved > 0 || usersRemoved > 0) {
      this.logger.info(`Cleaned up ${membersRemoved} member objects and ${usersRemoved} user objects`);
    }
  }
}
