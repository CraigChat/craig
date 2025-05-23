import { Guild } from '@prisma/client';
import axios from 'axios';
import { stripIndents, stripIndentTransformer, TemplateTag } from 'common-tags';
import { CommandContext, DexareCommand } from 'dexare';
import Eris from 'eris';
import { ButtonStyle, ComponentActionRow, ComponentType, Member, MessageOptions } from 'slash-create';

import type { CraigBot, CraigBotConfig } from './bot';
import type Recording from './modules/recorder/recording';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const version = require('../package.json').version;

export const userAgent = `CraigBot (https://craig.chat ${version}) Node.js/${process.version}`;

export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function makeError(obj: any) {
  const err = new Error(obj.message);
  err.name = obj.name;
  err.stack = obj.stack;
  return err;
}

export function makePlainError(err: Error) {
  const obj: any = {};
  obj.name = err.name;
  obj.message = err.message;
  obj.stack = err.stack;
  return obj;
}

export function checkRecordingPermission(member: Member, guildData?: Guild | null) {
  if (!member) return false;
  if (member.permissions.has('MANAGE_GUILD')) return true;
  if (guildData && member.roles.some((r) => guildData.accessRoles.some((g) => g === r))) return true;
  return false;
}

export function checkRecordingPermissionEris(member: Eris.Member, guildData?: Guild | null) {
  if (!member) return false;
  if (member.permissions.has('manageGuild')) return true;
  if (guildData && member.roles.some((r) => guildData.accessRoles.some((g) => g === r))) return true;
  return false;
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export function disableComponents(components: ComponentActionRow[]) {
  return components.map((c) => ({
    ...c,
    components: c.components.map((c) => ({ ...c, disabled: true }))
  }));
}

export async function getDiscordStatus(): Promise<null | 'none' | 'critical' | 'major' | 'minor' | 'maintenence'> {
  try {
    const response = await axios.get('https://discordstatus.com/api/v2/status.json', {
      headers: { 'User-Agent': userAgent }
    });
    return response.data?.status?.indicator;
  } catch (e) {
    return null;
  }
}

export const stripIndentsAndLines = new TemplateTag(stripIndentTransformer('all'), {
  onEndResult(endResult) {
    return endResult
      .replace(/[^\S\n]+$/gm, '')
      .replace(/^\n/, '')
      .replace(/\n\n+/, '\n');
  }
});

export function makeDownloadMessage(recording: Recording, config: CraigBotConfig) {
  const recordTime = Date.now() + 1000 * 60 * 60;
  const expireTime = Date.now() + 1000 * 60 * 60;
  return {
    embeds: [
      {
        description: stripIndents`
          Started recording in <#${recording.channel.id}> at <t:${Math.floor(Date.now() / 1000)}:F>.
          > You can bring up the recording panel with \`/join\`.

          ${stripIndentsAndLines`
            **Guild:** ${recording.channel.guild.name} (${recording.channel.guild.id})
            **Recording ID:** \`${recording.id}\`
            **Delete key:** ||\`${recording.deleteKey}\`|| (click to show)`}

          I will record up to X hours, I'll stop recording <t:${Math.floor(recordTime / 1000)}:R> from now.
          This recording will expire <t:${Math.floor(expireTime / 1000)}:R>. (X days from now)
        `,
        footer: {
          text: "The audio can be downloaded even while I'm still recording."
        }
      }
    ],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.LINK,
            label: 'Download',
            url: `https://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
            emoji: { id: '949825704923639828' }
          },
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.LINK,
            label: 'Delete recording',
            url: `https://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
            emoji: { id: '949825704596500481' }
          }
        ]
      },
      recording.messageChannelID && recording.messageID
        ? {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Jump to recording panel',
                url: `https://discordapp.com/channels/${recording.channel.guild.id}/${recording.messageChannelID}/${recording.messageID}`
              }
            ]
          }
        : null
    ].filter((c) => !!c)
  } as Eris.MessageContent<'hasNonce'>;
}

export async function replyOrSend(ctx: CommandContext, content: Eris.MessageContent): Promise<Eris.Message> {
  if ('permissionsOf' in ctx.channel && !ctx.channel.permissionsOf(ctx.client.bot.user.id).has('readMessageHistory'))
    return ctx.replyMention(content);
  else return ctx.reply(content);
}

export default abstract class TextCommand extends DexareCommand {
  // @ts-ignore
  client!: CraigBot;

  finalize(response: any, ctx: CommandContext) {
    if (typeof response === 'string' || (response && response.constructor && response.constructor.name === 'Object'))
      return replyOrSend(ctx, response);
  }
}

export async function getSelfMember(guild: Eris.Guild, client: Eris.Client) {
  return (await guild.fetchMembers({ userIDs: [client.user.id] }).catch(() => []))[0] ?? null;
}
