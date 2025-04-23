import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, paginateRecordings } from '../util';

export default class Recordings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'recordings',
      description: 'Access your previous recordings.',
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the recordings command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    // Get the last 5 recordings that arent expired
    const recordings = await this.prisma.recording.findMany({
      where: {
        userId: ctx.user.id,
        clientId: this.client.bot.user.id,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    if (recordings.length === 0)
      return {
        content: `You haven't done any recordings recently on ${this.client.bot.user.username}.`,
        ephemeral: true
      };

    const content = await paginateRecordings(this.client as any, ctx.user.id);
    return content;
  }
}
