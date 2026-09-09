import type { Ban, Guild } from '@craig/db';
import { prisma } from '@craig/db';
import type Dysnomia from '@projectdysnomia/dysnomia';
import { stripIndentTransformer, TemplateTag } from 'common-tags';
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

import packageJson from '../package.json';
import type { CraigBot } from './bot.js';
import type { CraigBotConfig, RewardTier } from './config.js';
import type { TFunction } from './i18n.js';
import type Recording from './modules/recorder/recording.js';
import type SlashModule from './modules/slash.js';

export const version = packageJson.version;

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

export function checkRecordingPermissionEris(member: Dysnomia.Member, guildData?: Guild | null) {
  if (!member) return false;
  if (member.permissions.has('manageGuild')) return true;
  if (guildData && member.roles.some((r) => guildData.accessRoles.some((g) => g === r))) return true;
  return false;
}

export function isChannelNotFull(channel: Dysnomia.StageChannel | Dysnomia.VoiceChannel, botUserId: string) {
  return !channel.userLimit || channel.voiceMembers.size < channel.userLimit || channel.permissionsOf(botUserId).has('voiceMoveMembers');
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
      if (
        comp.type === ComponentType.BUTTON ||
        comp.type === ComponentType.STRING_SELECT ||
        comp.type === ComponentType.USER_SELECT ||
        comp.type === ComponentType.ROLE_SELECT ||
        comp.type === ComponentType.CHANNEL_SELECT ||
        comp.type === ComponentType.MENTIONABLE_SELECT
      )
        comp.disabled = true;
      if ('components' in comp && Array.isArray(comp.components)) disableButtons(comp.components);
      if ('accessory' in comp && comp.accessory.type === ComponentType.BUTTON) comp.accessory.disabled = true;
    }
  }

  disableButtons(clone);
  return clone;
}

export async function getDiscordStatus(): Promise<null | 'none' | 'critical' | 'major' | 'minor' | 'maintenence'> {
  try {
    const response = await fetch('https://discordstatus.com/api/v2/status.json', {
      headers: { 'User-Agent': userAgent }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.status?.indicator;
  } catch (e) {
    return null;
  }
}

export const mainBotCommandOnly = process.argv?.[1].includes('slash-up') && process.env.EXTRA_BOT == 'true' ? [] : undefined;

export const stripIndentsAndLines = new TemplateTag(stripIndentTransformer('all'), {
  onEndResult(endResult) {
    return endResult
      .replace(/[^\S\n]+$/gm, '')
      .replace(/^\n/, '')
      .replace(/\n\n+/, '\n');
  }
});

export function makeDownloadMessage(recording: Recording, parsedRewards: ParsedRewards, config: CraigBotConfig, emojis: SlashModule['emojis']) {
  const t = recording.t;
  const recordTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.recordHours;
  const expireTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.downloadExpiryHours;
  const headerInfo = `${t(recording.autorecorded ? 'join_command.info_header_auto' : 'join_command.info_header', {
    channel: `<#${recording.channel.id}>`,
    time: `<t:${Math.floor(Date.now() / 1000)}:F>`
  })}\n${t('join_command.info_panel_reminder')}`;
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
              `**${t('common.guild')}:** ${recording.channel.guild.name} (${recording.channel.guild.id})`,
              `**${t('common.channel')}:** ${recording.channel.name} (${recording.channel.id})`,
              `**${t('common.rec_id')}:** \`${recording.id}\``,
              `**${t('common.delete_key')}:** ||\`${recording.deleteKey}\`|| ${t('common.click_to_show')}`,
              recording.webapp
                ? `**${t('common.webapp_url')}:** ${config.craig.webapp.connectUrl.replace('{id}', recording.id).replace('{key}', recording.ennuiKey)}`
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
            content: t('join_command.info_footer', {
              record_hours: parsedRewards.rewards.recordHours,
              record_time: `<t:${Math.floor(recordTime / 1000)}:R>`,
              expire_time: `<t:${Math.floor(expireTime / 1000)}:R>`,
              expiry_days: parsedRewards.rewards.downloadExpiryHours / 24
            })
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
                label: t('common.download'),
                url: `${config.craig.downloadProtocol ?? 'https'}://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
                emoji: emojis.getPartial('download')
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.LINK,
                label: t('join_command.delete_recording'),
                url: `${config.craig.downloadProtocol ?? 'https'}://${config.craig.downloadDomain}/rec/${recording.id}?key=${
                  recording.accessKey
                }&delete=${recording.deleteKey}`,
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
                      label: t('join_command.actions.jump_to_panel'),
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

export async function blessServer(userID: string, guildID: string, emojis: SlashModule['emojis'], t: TFunction): Promise<MessageOptions> {
  const userData = await prisma.user.findUnique({ where: { id: userID }, select: { id: true, rewardTier: true } });
  const blessing = await prisma.blessing.findUnique({ where: { guildId: guildID }, select: { userId: true } });
  const blessingUser = blessing
    ? blessing.userId === userID
      ? userData
      : await prisma.user.findUnique({ where: { id: blessing.userId }, select: { id: true, rewardTier: true } })
    : null;

  const userTier = userData?.rewardTier || 0;
  const guildTier = blessingUser?.rewardTier || 0;

  if (blessingUser && blessingUser.id === userID)
    return {
      content: t('blessing.already_blessed'),
      ephemeral: true,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.DESTRUCTIVE,
              label: t('blessing.remove'),
              custom_id: `user:unbless:${guildID}`,
              emoji: emojis.getPartial('remove') || undefined
            }
          ]
        }
      ]
    };

  if (userTier === 0)
    return {
      content: t('blessing.no_perks'),
      ephemeral: true
    };

  if (guildTier === -1 || (guildTier >= userTier && userTier !== -1))
    return {
      content: t('blessing.server_already_blessed'),
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
    content: t('blessing.blessed'),
    ephemeral: true
  };
}

export async function unblessServer(userID: string, guildID: string, t: TFunction): Promise<MessageOptions> {
  const blessing = await prisma.blessing.findUnique({ where: { guildId: guildID }, select: { userId: true } });

  if (!blessing || blessing.userId !== userID)
    return {
      content: t('blessing.not_blessed'),
      ephemeral: true
    };

  await prisma.blessing.delete({
    where: { guildId: guildID }
  });

  return {
    content: t('blessing.removed'),
    ephemeral: true
  };
}

export async function paginateRecordings(client: CraigBot, userID: string, requestedPage = 1) {
  const MAX_PAGE_AMOUNT = 5;
  const requested = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
  const where = {
    userId: userID,
    clientId: client.bot.user.id,
    expiresAt: { gt: new Date() }
  };
  const [recordings, recordingCount] = await prisma.$transaction([
    prisma.recording.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (requested - 1) * MAX_PAGE_AMOUNT,
      take: MAX_PAGE_AMOUNT,
      select: {
        id: true,
        accessKey: true,
        deleteKey: true,
        channelId: true,
        autorecorded: true,
        createdAt: true,
        expiresAt: true
      }
    }),
    prisma.recording.count({ where })
  ]);

  if (recordingCount === 0)
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
  const baseUrl = `${client.config.craig.downloadProtocol ?? 'https'}://${downloadDomain}`;
  const emojis = client.slash.emojis;
  const pages = Math.ceil(recordingCount / MAX_PAGE_AMOUNT);
  const page = Math.min(pages, requested);
  const pagedRecordings =
    page === requested
      ? recordings
      : await prisma.recording.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * MAX_PAGE_AMOUNT,
          take: MAX_PAGE_AMOUNT,
          select: {
            id: true,
            accessKey: true,
            deleteKey: true,
            channelId: true,
            autorecorded: true,
            createdAt: true,
            expiresAt: true
          }
        });

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
            content: `## Previous recordings on ${client.bot.user.mention}\n-# ${recordingCount.toLocaleString()} recording(s), Page ${page}/${pages}`
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
              url: `${baseUrl}/rec/${r.id}?key=${r.accessKey}`
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

export async function getSelfMember(guild: Dysnomia.Guild, client: Dysnomia.Client) {
  return (await guild.fetchMembers({ userIDs: [client.user.id] }).catch(() => []))[0] ?? null;
}

export function formatVoiceCode(vpc: string, rows = 2) {
  const code = vpc.padEnd(rows * 15, '-');

  const result: string[] = [];
  for (const si in '-'.repeat(rows).split('')) {
    const i = Number(si);
    const row = code.slice(i * 15, (i + 1) * 15);

    const part1 = row.slice(0, 5);
    const part2 = row.slice(5, 10);
    const part3 = row.slice(10, 15);
    result.push(`\`${part1}\` \`${part2}\` \`${part3}\``);
  }

  return result.join('\n');
}
