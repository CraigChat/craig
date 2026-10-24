import { type Expression, type ExpressionBuilder, expressionBuilder, sql } from 'kysely';

import type { DB } from '../.kysely/types.js';
import { db } from './index.js';
import type { DbClient, GuildBlessing } from './utils.js';

export function activeRewardTier(userId: string | Expression<string>) {
  return expressionBuilder<DB>()
    .selectFrom('Entitlement')
    .select(sql<number>`case when bool_or("Entitlement"."tier" = -1) then -1 else coalesce(max("Entitlement"."tier"), 0) end`.as('tier'))
    .where('Entitlement.userId', '=', userId)
    .where((eb) => eb.or([eb('Entitlement.expiresAt', 'is', null), eb('Entitlement.expiresAt', '>', new Date())]));
}

export function rewardTierUpdate(eb: ExpressionBuilder<DB, 'User'>) {
  const tier = activeRewardTier(eb.ref('User.id'));
  return {
    rewardTier: tier,
    driveEnabled: eb.and([eb.ref('User.driveEnabled'), eb(tier, '!=', 0)]).$castTo<boolean>()
  };
}

export async function updateRewardTiers(userIds: string[], client: DbClient = db) {
  if (userIds.length === 0) return;
  await client
    .updateTable('User')
    .set(rewardTierUpdate)
    .where((eb) => eb('id', '=', eb.fn.any(eb.val(userIds))))
    .execute();
}

/** Get the blessing of a guild. */
export async function getGuildBlessing(guildId: string, client: DbClient = db): Promise<GuildBlessing | null> {
  const row = await client
    .selectFrom('Blessing')
    .leftJoin('User', 'User.id', 'Blessing.userId')
    .select(['Blessing.userId', 'User.rewardTier'])
    .where('Blessing.guildId', '=', guildId)
    .executeTakeFirst();
  if (!row) return null;
  return { userId: row.userId, rewardTier: row.rewardTier ?? 0 };
}

/** Get the access roles of a guild. */
export async function getGuildAccessRoles(guildId: string, client: DbClient = db): Promise<string[] | null> {
  const row = await client.selectFrom('Guild').select('accessRoles').where('id', '=', guildId).executeTakeFirst();
  return row?.accessRoles ?? null;
}

/** Get the reward tier of a user. */
export async function getRewardTier(userId: string, client: DbClient = db): Promise<number> {
  const row = await client.selectFrom('User').select('rewardTier').where('id', '=', userId).executeTakeFirst();
  return row?.rewardTier ?? 0;
}
