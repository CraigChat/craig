import { stripIndents } from 'common-tags';
import { ButtonStyle, CommandContext, ComponentType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan } from '../util';

export default class Info extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'info',
      description: 'Get information and statistics about this bot.',
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
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the info command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

    const [guildCount, recordings] = await this.sharding.getCounts();

    return {
      content: stripIndents`
        ${this.emojis.getMarkdown('craig')} **Craig** is a multi-track voice channel recorder.
        I am in **${guildCount.toLocaleString()}** guilds and currently recording **${recordings.toLocaleString()}** conversations.

        This server is on shard ${this.client.shard?.id ?? process.env.SHARD_ID} with ${
        this.client.shard?.latency ?? '<unknown>'
      } milliseconds of latency.
      `,
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
              label: 'Invite',
              url: `https://discord.com/oauth2/authorize?client_id=${
                this.client.config.craig.inviteID ?? this.client.config.applicationID
              }&permissions=0&scope=bot%20applications.commands`,
              emoji: this.emojis.getPartial('craig')
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'Support Server',
              url: 'https://discord.gg/craig'
            }
          ]
        }
      ]
    };
  }
}
