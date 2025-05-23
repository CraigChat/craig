import { Ban, Guild } from '@prisma/client';
import axios from 'axios';
import { stripIndents, stripIndentTransformer, TemplateTag } from 'common-tags';
import { CommandContext, DexareCommand } from 'dexare';
import Eris from 'eris';
import { ButtonStyle, ComponentActionRow, ComponentType, Member, MessageOptions } from 'slash-create';

import type { CraigBot, CraigBotConfig, RewardTier } from './bot';
import type Recording from './modules/recorder/recording';
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

export function makeDownloadMessage(recording: Recording, parsedRewards: ParsedRewards, config: CraigBotConfig) {
  const recordTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.recordHours;
  const expireTime = Date.now() + 1000 * 60 * 60 * parsedRewards.rewards.downloadExpiryHours;
  return {
    embeds: [
      {
        description: stripIndents`
          Started ${recording.autorecorded ? 'auto-' : ''}recording in <#${recording.channel.id}> at <t:${Math.floor(Date.now() / 1000)}:F>.
          > You can bring up the recording panel with \`/join\`.

          ${stripIndentsAndLines`
            **Guild:** ${recording.channel.guild.name} (${recording.channel.guild.id})
            **Recording ID:** \`${recording.id}\`
            **Delete key:** ||\`${recording.deleteKey}\`|| (click to show)
            ${
              recording.webapp
                ? `**Webapp URL:** ${config.craig.webapp.connectUrl.replace('{id}', recording.id).replace('{key}', recording.ennuiKey)}`
                : ''
            }`}

          I will record up to ${parsedRewards.rewards.recordHours} hours, I'll stop recording <t:${Math.floor(recordTime / 1000)}:R> from now.
          This recording will expire <t:${Math.floor(expireTime / 1000)}:R>. (${parsedRewards.rewards.downloadExpiryHours / 24} days from now)
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
            url: `http://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}`,
            emoji: { id: '949825704923639828' }
          },
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.LINK,
            label: 'Delete recording',
            url: `http://${config.craig.downloadDomain}/rec/${recording.id}?key=${recording.accessKey}&delete=${recording.deleteKey}`,
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
                url: `http://discordapp.com/channels/${recording.channel.guild.id}/${recording.messageChannelID}/${recording.messageID}`
              }
            ]
          }
        : null
    ].filter((c) => !!c)
  } as Eris.MessageContent<'hasNonce'>;
}

export async function blessServer(userID: string, guildID: string): Promise<MessageOptions> {
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
              emoji: { id: '887142796560060426' }
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
