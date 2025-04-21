import { stripIndents } from 'common-tags';
import { CommandContext, DexareClient } from 'dexare';
import { ButtonStyle, ComponentType } from 'slash-create';

import RecorderModule from '../modules/recorder';
import { prisma } from '../prisma';
import TextCommand, { checkRecordingPermissionEris, replyOrSend } from '../util';

export default class LeaveCommand extends TextCommand {
  constructor(client: DexareClient<any>) {
    super(client, {
      name: 'leave',
      aliases: ['stop']
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (ctx.member) {
      const hasPermission = checkRecordingPermissionEris(ctx.member!, await prisma.guild.findFirst({ where: { id: ctx.member.guild.id } }));
      if (hasPermission) {
        const recorder = this.client.modules.get('recorder') as RecorderModule<any>;
        const recording = recorder.recordings.get(ctx.member.guild.id);
        await recording?.stop(false, ctx.member.id);
      }
    }

    await replyOrSend(ctx, {
      content: stripIndents`
        **${this.client.bot.user.username}** now uses slash commands for recordings!
        Please make sure that my commands are showing up when typing \`/\` in your chat box.

        *If you had any recordings in progress, they have been stopped.*
      `,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'Add slash commands to this server',
              url: `https://discord.com/oauth2/authorize?client_id=${
                this.client.config.craig.inviteID ?? this.client.config.applicationID
              }&permissions=0&scope=applications.commands&guild_id=${ctx.guild?.id}`,
              emoji: this.emojis.getPartial('craig') || undefined
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'What are slash commands?',
              url: 'https://support.discord.com/hc/en-us/articles/1500000368501-Slash-Commands-FAQ',
              emoji: { name: '❔' }
            }
          ]
        }
      ]
    });
  }
}
