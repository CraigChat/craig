import { stripIndents } from 'common-tags';
import { CommandContext, DexareClient, DexareCommand } from 'dexare';
import { ButtonStyle, ComponentType } from 'slash-create';
import { CraigBot } from '../bot';

export default class InfoCommand extends DexareCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'info'
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    const client = this.client as unknown as CraigBot;
    await ctx.reply({
      content: stripIndents`
        <:craig:${client.config.craig.emoji}> **Craig** is a multi-track voice channel recorder.
        This server is on shard ${client.shard?.id ?? process.env.SHARD_ID} with ${
        client.shard?.latency ?? '<unknown>'
      } milliseconds of latency.
      `,
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
    });
  }
}
