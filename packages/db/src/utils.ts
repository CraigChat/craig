import type { Kysely, Selectable } from 'kysely';

import type * as Tables from '../.kysely/types.js';
import type { DB } from '../.kysely/types.js';

export type DbClient = Kysely<DB>;

export interface GuildBlessing {
  userId: string;
  rewardTier: number;
}

export type User = Selectable<Tables.User>;
export type UserToken = Selectable<Tables.UserToken>;
export type Ban = Selectable<Tables.Ban>;
export type Guild = Selectable<Tables.Guild>;
export type Blessing = Selectable<Tables.Blessing>;
export type Entitlement = Selectable<Tables.Entitlement>;
export type Patreon = Selectable<Tables.Patreon>;
export type Recording = Selectable<Tables.Recording>;
export type AutoRecord = Selectable<Tables.AutoRecord>;
export type GoogleDriveUser = Selectable<Tables.GoogleDriveUser>;
export type MicrosoftUser = Selectable<Tables.MicrosoftUser>;
export type DropboxUser = Selectable<Tables.DropboxUser>;
export type BoxUser = Selectable<Tables.BoxUser>;
