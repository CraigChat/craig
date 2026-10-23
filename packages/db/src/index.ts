import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { DB } from '../.kysely/types.js';

defaults.parseInputDatesAsUTC = true;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX) || 2,
  // Prisma's pool timeout is 10s
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT) || 10_000,
  // force timestamps to UTC like Prisma
  options: '-c TimeZone=UTC',
  types: {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
      if (format === 'binary') return types.getTypeParser(oid, format);
      if (oid === 1114) return (value: string) => new Date(`${value.replace(' ', 'T')}Z`);
      // int8, mainly for count(*) and other aggregations
      if (oid === 20) return (value: string) => Number(value);
      return types.getTypeParser(oid, format);
    }) as typeof types.getTypeParser
  }
});

// idle clients emit errors when the server drops them (restarts, failovers), the pool replaces them
pool.on('error', (err) => console.error('[db] Idle client error:', err.message));

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type { DB };
export * from './queries.js';
export type * from './utils.js';
export type { Insertable, Selectable, Updateable } from 'kysely';
