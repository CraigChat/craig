import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { DB } from '../.kysely/types.js';

// Timestamps without a timezone are stored as UTC but `pg` uses local time
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

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type { DB };
export * from './queries.js';
export type * from './utils.js';
export type { Insertable, Selectable, Updateable } from 'kysely';
