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
