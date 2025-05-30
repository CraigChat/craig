import { Ban, Guild } from '@prisma/client';
import axios from 'axios';
import { stripIndents, stripIndentTransformer, TemplateTag } from 'common-tags';
import { CommandContext, DexareCommand } from 'dexare';
import Eris from 'eris';
import {
  AnyComponent,
  ButtonStyle,
  ComponentType,
  EditMessageOptions,
  Member,
  MessageFlags,
  MessageOptions,
  SeparatorSpacingSize
} from 'slash-create';

import type { CraigBot, CraigBotConfig, RewardTier } from './bot';
import type Recording from './modules/recorder/recording';
import type SlashModule from './modules/slash';
import { prisma } from './prisma';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const version = require('../package.json').version;

export const userAgent = `CraigBot (https://craig.chat ${version}) Node.js/${process.version}`;

let lastBanUpdate = 0;
let bans: Ban[] = [];

export async function checkBan(userId: string) {
  if (Date.now() - lastBanUpdate > 30 * 1000) {
    const nextBans = await prisma.ban.findMany().catch(() => null);
    if (nextBans) {
      bans = nextBans;
      lastBanUpdate = Date.now();
    }
  }

  return bans.some((ban) => ban.id === userId && ban.type === 0);
}

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

export interface ParsedRewards {
  tier: number;
  rewards: RewardTier;
}

export function parseRewards(config: CraigBotConfig, tier = 0, guildTier = 0): ParsedRewards {
  const userRewards = config.craig.rewardTiers[tier] || config.craig.rewardTiers[0];
  const guildRewards = config.craig.rewardTiers[guildTier] || config.craig.rewardTiers[0];
  if (tier === -1 || (tier >= guildTier && guildTier !== -1)) return { tier, rewards: userRewards };
  return { tier: guildTier, rewards: guildRewards };
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export function disableComponents(components: AnyComponent[]) {
  if (!components) return components;

  const clone = JSON.parse(JSON.stringify(components));

  function disableButtons(comps: AnyComponent[]) {
    for (const comp of comps) {
      if (comp.type === ComponentType.BUTTON) comp.disabled = true;
      if ('components' in comp && Array.isArray(comp.components)) disableButtons(comp.components);
    }
  }

  disableButtons(clone);
  return clone;
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

export function makeDownloadMessage(recording: Recording, parsedRewards: ParsedRewards, config: CraigBotConfig, emojis: SlashModule<any>['emojis']) {
  const recordTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.recordHours;
  const expireTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.downloadExpiryHours;
  const headerInfo = `Started ${recording.autorecorded ? 'auto-' : ''}recording in <#${recording.channel.id}> at <t:${Math.floor(
    Date.now() / 1000
  )}:F>.\n-# You can bring up the recording panel with \`/join\`.`;
  return {
    flags: MessageFlags.IS_COMPONENTS_V2,
    components: [
      {
        type: ComponentType.CONTAINER,
        components: [
          recording.channel.guild.icon
            ? {
                type: ComponentType.SECTION,
                accessory: {
                  type: ComponentType.THUMBNAIL,
                  media: { url: recording.channel.guild.dynamicIconURL('png', 128) }
                },
                components: [
                  {
                    type: ComponentType.TEXT_DISPLAY,
                    content: headerInfo
                  }
                ]
              }
            : {
                type: ComponentType.TEXT_DISPLAY,
                content: headerInfo
              },
          {
            type: ComponentType.SEPARATOR,
            divider: true,
            spacing: SeparatorSpacingSize.SMALL
          },
          {
            type: ComponentType.TEXT_DISPLAY,
            content: [
              `**Guild:** ${recording.channel.guild.name} (${recording.channel.guild.id})`,
              `**Channel:** ${recording.channel.name} (${recording.channel.id})`,
              `**Recording ID:** \`${recording.id}\``,
              `**Delete key:** ||\`${recording.deleteKey}\`|| (click to show)`,
              recording.webapp
                ? `**Webapp URL:** ${config.craig.webapp.connectUrl.replace('{id}', recording.id).replace('{key}', recording.ennuiKey)}`
                : ''
            ]
              .filter((v) => !!v)
              .join('\n')
          },
          {
            type: ComponentType.SEPARATOR,
            divider: true,
            spacing: SeparatorSpacingSize.SMALL
          },
          {
            type: ComponentType.TEXT_DISPLAY,
            content: stripIndents`
              I will record up to ${parsedRewards.rewards.recordHours} hours, I'll stop recording <t:${Math.floor(recordTime / 1000)}:R> from now.
              This recording will expire <t:${Math.floor(expireTime / 1000)}:R>. (${parsedRewards.rewards.downloadExpiryHours / 24} days from now)
              -# The audio can be downloaded even while I'm still recording.
            `
          },
          {
            type: ComponentType.SEPARATOR,
            divider: true,
            spacing: SeparatorSpacingSize.SMALL
          },
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Download',
                url: `https://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
                emoji: emojis.getPartial('download')
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: 'Delete recording',
                url: `https://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
                emoji: emojis.getPartial('delete')
              }
            ]
          },
          ...(recording.messageChannelID && recording.messageID
            ? [
                {
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
              ]
            : [])
        ]
      }
    ]
  } as EditMessageOptions as any;
}

export async function blessServer(userID: string, guildID: string, emojis: SlashModule<any>['emojis']): Promise<MessageOptions> {
  const userData = await prisma.user.findFirst({ where: { id: userID } });
  const blessing = await prisma.blessing.findFirst({ where: { guildId: guildID } });
  const blessingUser = blessing ? (blessing.userId === userID ? userData : await prisma.user.findFirst({ where: { id: blessing.userId } })) : null;

  const userTier = userData?.rewardTier || 0;
  const guildTier = blessingUser?.rewardTier || 0;

  if (blessingUser && blessingUser.id === userID)
    return {
      content: 'You already blessed this server.',
      ephemeral: true,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.DESTRUCTIVE,
              label: 'Remove blessing',
              custom_id: `user:unbless:${guildID}`,
              emoji: emojis.getPartial('remove') || undefined
            }
          ]
        }
      ]
    };

  if (userTier === 0)
    return {
      content: "You don't have any perks to bless this server with.",
      ephemeral: true
    };

  if (guildTier === -1 || (guildTier >= userTier && userTier !== -1))
    return {
      content: 'This server has already been blessed by a similar or greater tier.',
      ephemeral: true
    };

  // Remove other blessings
  if (userTier !== -1) await prisma.blessing.deleteMany({ where: { userId: userID } });

  await prisma.blessing.upsert({
    where: { guildId: guildID },
    update: { userId: userID },
    create: { guildId: guildID, userId: userID }
  });

  return {
    content: 'You have blessed this server and gave it your perks. All future recordings will have your features.',
    ephemeral: true
  };
}

export async function unblessServer(userID: string, guildID: string): Promise<MessageOptions> {
  const blessing = await prisma.blessing.findFirst({ where: { guildId: guildID } });

  if (!blessing || blessing.userId !== userID)
    return {
      content: 'You have not blessed this server.',
      ephemeral: true
    };

  await prisma.blessing.delete({
    where: { guildId: guildID }
  });

  return {
    content: 'Removed your blessing from this server.',
    ephemeral: true
  };
}

export async function paginateRecordings(client: CraigBot, userID: string, requestedPage = 1) {
  const recordings = await prisma.recording.findMany({
    where: {
      userId: userID,
      clientId: client.bot.user.id,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (recordings.length === 0)
    return {
      flags: MessageFlags.IS_COMPONENTS_V2 + MessageFlags.EPHEMERAL,
      components: [
        {
          type: ComponentType.TEXT_DISPLAY,
          content: `You haven't done any recordings recently on ${client.bot.user.mention}.`
        }
      ]
    } as EditMessageOptions;

  const downloadDomain = client.config.craig.downloadDomain;
  const emojis = (client.modules.get('slash') as SlashModule<any>).emojis;
  const MAX_PAGE_AMOUNT = 5;
  const pages = Math.ceil(recordings.length / MAX_PAGE_AMOUNT);
  const page = Math.min(pages, Math.max(1, requestedPage));
  const pagedRecordings = recordings.slice((page - 1) * MAX_PAGE_AMOUNT, page * MAX_PAGE_AMOUNT);

  return {
    flags: MessageFlags.IS_COMPONENTS_V2 + MessageFlags.EPHEMERAL,
    allowedMentions: {
      everyone: false,
      users: false,
      roles: false
    },
    components: [
      {
        type: ComponentType.CONTAINER,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: `## Previous recordings on ${
              client.bot.user.mention
            }\n-# ${recordings.length.toLocaleString()} recording(s), Page ${page}/${pages}`
          },
          {
            type: ComponentType.SEPARATOR,
            divider: true,
            spacing: SeparatorSpacingSize.SMALL
          },
          ...pagedRecordings.map((r) => ({
            type: ComponentType.SECTION,
            components: [
              {
                type: ComponentType.TEXT_DISPLAY,
                content: stripIndentsAndLines`
                  ### 🎙️ Recording \`${r.id}\` - **<t:${Math.floor(r.createdAt.valueOf() / 1000)}:f>**
                  ${r.autorecorded ? '*`Autorecorded`*' : ''} <#${r.channelId}> • Expires <t:${Math.floor(
                  r.expiresAt.valueOf() / 1000
                )}:R> • Delete Key: ||\`${r.deleteKey}\`||
                `
              }
            ],
            accessory: {
              type: ComponentType.BUTTON,
              style: ButtonStyle.LINK,
              label: 'Download',
              emoji: emojis.getPartial('download'),
              url: `https://${downloadDomain}/rec/${r.id}?key=${r.accessKey}`
            }
          })),
          {
            type: ComponentType.SEPARATOR,
            divider: true,
            spacing: SeparatorSpacingSize.SMALL
          },
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.PRIMARY,
                custom_id: `user:recordings:${Math.max(1, page - 1)}:prev`,
                disabled: page <= 1,
                emoji: emojis.getPartial('prev')
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SECONDARY,
                custom_id: 'noop',
                disabled: true,
                label: `${page}/${pages}`
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.PRIMARY,
                custom_id: `user:recordings:${Math.min(pages, page + 1)}:next`,
                disabled: page >= pages,
                emoji: emojis.getPartial('next')
              }
            ]
          }
        ]
      }
    ]
  } as EditMessageOptions;
}

export async function replyOrSend(ctx: CommandContext, content: Eris.MessageContent): Promise<Eris.Message> {
  if ('permissionsOf' in ctx.channel && !ctx.channel.permissionsOf(ctx.client.bot.user.id).has('readMessageHistory'))
    return ctx.replyMention(content);
  else return ctx.reply(content);
}

export default abstract class TextCommand extends DexareCommand {
  // @ts-ignore
  client!: CraigBot;

  get emojis() {
    return (this.client.modules.get('slash') as SlashModule<any>).emojis;
  }

  finalize(response: any, ctx: CommandContext) {
    if (typeof response === 'string' || (response && response.constructor && response.constructor.name === 'Object'))
      return replyOrSend(ctx, response);
  }
}

export async function getSelfMember(guild: Eris.Guild, client: Eris.Client) {
  return (await guild.fetchMembers({ userIDs: [client.user.id] }).catch(() => []))[0] ?? null;
}
