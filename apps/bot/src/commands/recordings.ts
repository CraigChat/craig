import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, paginateRecordings } from '../util.js';

export default class Recordings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'recordings',
      description: 'Access your previous recordings.',
      deferEphemeral: true
    });
  }

  async run(ctx: CommandContext) {
    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the recordings command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    return await paginateRecordings(this.client as any, ctx.user.id);
  }
}
