import { Guild } from '@prisma/client';
import { ButtonStyle, ComponentType, Member, MessageOptions } from 'slash-create';
import { CraigBotConfig, RewardTier } from './bot';
import { prisma } from './prisma';

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

export interface ParsedRewards {
  tier: number;
  rewards: RewardTier;
}

export function parseRewards(config: CraigBotConfig, tier: number = 0, guildTier: number = 0): ParsedRewards {
  const userRewards = config.craig.rewardTiers[tier] || config.craig.rewardTiers[0];
  const guildRewards = config.craig.rewardTiers[guildTier] || config.craig.rewardTiers[0];
  if (tier === -1 || (tier >= guildTier && guildTier !== -1)) return { tier, rewards: userRewards };
  return { tier: guildTier, rewards: guildRewards };
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export async function blessServer(userID: string, guildID: string): Promise<MessageOptions> {
  const userData = await prisma.user.findFirst({ where: { id: userID } });
  const blessing = await prisma.blessing.findFirst({ where: { guildId: guildID } });
  const blessingUser = blessing
    ? blessing.userId === userID
      ? userData
      : await prisma.user.findFirst({ where: { id: blessing.userId } })
    : null;

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

  if (guildTier === -1 || (guildTier >= userTier && userTier !== -1))
    return {
      content: 'This server has already been blessed by a similar or greater tier.',
      ephemeral: true
    };

  if (userTier === 0)
    return {
      content: "You don't have any perks to bless this server with.",
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
