import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, displayUserSettings, mainBotCommandOnly } from '../util.js';

export default class UserSettings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'user-settings',
      description: 'Manage user settings.',
      deferEphemeral: true,
      guildIDs: mainBotCommandOnly
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the user-settings command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const userSettings = (await this.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { webapp: true }
    })) || { webapp: false };

    return displayUserSettings(this.client, userSettings, t);
  }
}
