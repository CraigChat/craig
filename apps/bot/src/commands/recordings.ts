import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, stripIndentsAndLines } from '../util';

export default class Recordings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'recordings',
      description: 'Get links to your last 5 recordings.',
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
      take: 5
    });

    if (recordings.length === 0)
      return {
        content: "You haven't done any recordings recently.",
        ephemeral: true
      };

    const config = this.client.config;
    return {
      embeds: [
        {
          author: {
            icon_url: this.client.bot.user.dynamicAvatarURL(),
            name: `Your last 5 recordings on ${this.client.bot.user.username}`
          },
          fields: recordings.map((r) => {
            return {
              name: `Recording \`${r.id}\` - <t:${Math.floor(r.createdAt.valueOf() / 1000)}:F>`,
              value: stripIndentsAndLines`
                ${r.autorecorded ? 'Auto-recorded' : 'Recorded'} in <#${r.channelId}>
                Expires <t:${Math.floor(r.expiresAt.valueOf() / 1000)}:R> (<t:${Math.floor(r.expiresAt.valueOf() / 1000)}:F>)
                [Download](https://${config.craig.downloadDomain}/rec/${r.id}?key=${r.accessKey}) - [Delete](https://${
                config.craig.downloadDomain
              }/rec/${r.id}?key=${r.accessKey}&delete=${r.deleteKey})
              `
            };
          })
        }
      ],
      ephemeral: true
    };
  }
}
