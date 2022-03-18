import { stripIndents } from 'common-tags';
import { SlashCreator, ComponentType, ButtonStyle } from 'slash-create';
import GeneralCommand from '../slashCommand';

export default class Info extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'info',
      description: 'Get information and statistics about this bot.'
    });

    this.filePath = __filename;
  }

  async run() {
    const [guildCount, recordings] = await this.sharding.getCounts();

    return {
      content: stripIndents`
        <:craig:${this.client.config.craig.emoji}> **Craig** is a multi-track voice channel recorder.
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
              emoji: {
                id: this.client.config.craig.emoji
              }
            }
          ]
        }
      ]
    };
  }
}
