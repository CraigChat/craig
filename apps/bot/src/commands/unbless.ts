import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, unblessServer } from '../util.js';

export default class Bless extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'unbless',
      description: 'Remove your blessing from this server.',
      deferEphemeral: true,
      dmPermission: false
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (!ctx.guildID) return t('responses.guild_only');

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the unbless command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    return await unblessServer(ctx.user.id, ctx.guildID, t);
  }
}
