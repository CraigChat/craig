import { ButtonStyle, CommandContext, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan } from '../util.js';

export default class Info extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'info',
      description: 'Get information and statistics about this bot.',
      deferEphemeral: true
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
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the info command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const [guilds, recordings] = await this.sharding.getCounts();

    return {
      content:
        this.emojis.getMarkdown('craig') +
        ' ' +
        t('info.text', {
          guilds,
          recordings,
          shard: this.client.shard?.id ?? process.env.SHARD_ID,
          ms: this.client.shard?.latency ?? '<unknown>'
        }),
      ephemeral: true,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'craig.chat',
              url: this.client.config.craig.homepage
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: t('common.add_to_server'),
              url: `https://discord.com/oauth2/authorize?client_id=${
                this.client.config.craig.inviteID ?? this.client.config.applicationID
              }&permissions=0&scope=bot%20applications.commands`,
              emoji: this.emojis.getPartial('craig')
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: t('common.support_server'),
              url: 'https://discord.gg/craig'
            }
          ]
        }
      ]
    };
  }
}
