import type { Kysely } from 'kysely';

import type { DB } from '../.kysely/types.js';

export type DbClient = Kysely<DB>;

export interface GuildBlessing {
  userId: string;
  rewardTier: number;
}
