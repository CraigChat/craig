import { Guild } from '@prisma/client';
import { Member } from 'slash-create';
import { CraigBotConfig, RewardTier } from './bot';

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
  if (tier >= guildTier || tier === -1) return { tier, rewards: userRewards };
  return { tier: guildTier, rewards: guildRewards };
}

export function cutoffText(text: string, limit = 2000) {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
