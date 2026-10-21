import { PrismaPg } from '@prisma/adapter-pg';
import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { DB } from '../.kysely/types.js';
import { PrismaClient } from '../.prisma-client/client.js';

// Prisma handles non-timezone timestamps as UTC but `pg` uses local time
defaults.parseInputDatesAsUTC = true;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  types: {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
      oid === 1114 && format !== 'binary'
        ? (value: string) => new Date(`${value.replace(' ', 'T')}Z`)
        : types.getTypeParser(oid, format)) as typeof types.getTypeParser
  }
});

/** @deprecated */
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type { DB };
export type * as Tables from '../.kysely/types.js';
export * from '../.prisma-client/client.js';
export * from './queries.js';
export type { Insertable, Selectable, Updateable } from 'kysely';
export type {
  AutoRecord,
  Ban,
  Blessing,
  BoxUser,
  DbClient,
  DropboxUser,
  Entitlement,
  GoogleDriveUser,
  Guild,
  GuildBlessing,
  MicrosoftUser,
  Patreon,
  Recording,
  User,
  UserToken
} from './utils.js';
