import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { stripIndentsAndLines } from '../util';

export default class Recordings extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'recordings',
      description: 'Mostrar os links para as suas ultimas 10 gravações.',
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the recordings command, but was ratelimited.`
      );
      return {
        content: 'Espere alguns segundos andes de usar esse comando.',
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
        content: `Não há gravações recentes.`,
        ephemeral: true
      };

    const config = this.client.config;
    return {
      embeds: [
        {
          author: {
            icon_url: this.client.bot.user.dynamicAvatarURL(),
            name: `Suas ultimas 10 gravações:`
          },
          fields: recordings.map((r) => {
            return {
              name: `🎙️ Gravação \`${r.id}\` - <t:${Math.floor(r.createdAt.valueOf() / 1000)}:F>`,
              value: stripIndentsAndLines`
                'Gravado em' in <#${r.channelId}>
                Expira em <t:${Math.floor(r.expiresAt.valueOf() / 1000)}:R> (<t:${Math.floor(r.expiresAt.valueOf() / 1000)}:F>)
                [Download](https://${config.craig.downloadDomain}/rec/${r.id}?key=${r.accessKey}) - [Deletar](https://${
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
