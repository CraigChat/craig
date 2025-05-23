import { stripIndents } from 'common-tags';
import { CommandContext, DexareClient } from 'dexare';
import { ButtonStyle, ComponentType } from 'slash-create';

import TextCommand, { replyOrSend } from '../util';

export default class InfoCommand extends TextCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'info'
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    await replyOrSend(ctx, {
      content: stripIndents`
        ${this.emojis.getMarkdown('craig')} **Craig** is a multi-track voice channel recorder.
        This server is on shard ${this.client.shard?.id ?? process.env.SHARD_ID} with ${
        this.client.shard?.latency ?? '<unknown>'
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
              emoji: this.emojis.getPartial('craig') || undefined
            }
          ]
        }
      ]
    });
  }
}
