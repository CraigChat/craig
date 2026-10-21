import { db } from './index.js';
import type { DbClient, GuildBlessing } from './utils.js';

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
export async function getUserBlessing(userId: string, client: DbClient = db): Promise<number> {
  const row = await client.selectFrom('User').select('rewardTier').where('id', '=', userId).executeTakeFirst();
  return row?.rewardTier ?? 0;
}
