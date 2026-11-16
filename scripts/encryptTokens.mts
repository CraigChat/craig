// Encrypts stored OAuth tokens that are plaintext or encrypted with an older key.
// Dry run by default, pass --write to apply. Safe to re-run.
import { db, decryptToken, encryptToken, tokenAad, tokenPrefix } from '@craig/db';

const TABLES = {
  UserToken: ['accessToken', 'refreshToken'],
  GoogleDriveUser: ['token', 'refreshToken'],
  MicrosoftUser: ['token', 'refreshToken'],
  DropboxUser: ['token', 'refreshToken'],
  BoxUser: ['token', 'refreshToken']
} as const;
const BATCH_SIZE = 500;

const write = process.argv.includes('--write');

try {
  const prefix = tokenPrefix();

  for (const [table, columns] of Object.entries(TABLES) as [keyof typeof TABLES, readonly string[]][]) {
    const from = table as 'BoxUser';
    const refs = columns as readonly 'token'[];
    let lastId = '';
    let pending = 0;
    let encrypted = 0;

    while (true) {
      const rows = await db
        .selectFrom(from)
        .selectAll()
        .where('id', '>', lastId)
        .where((eb) => eb.or(refs.map((column) => eb(column, 'not like', `${prefix}%`))))
        .orderBy('id')
        .limit(BATCH_SIZE)
        .execute();
      if (rows.length === 0) break;
      lastId = rows.at(-1)!.id;

      for (const row of rows) {
        for (const column of refs) {
          const value = row[column];
          if (value == null || value.startsWith(prefix)) continue;
          pending++;
          if (!write) continue;

          const aad = tokenAad(table, column as never, row.id);
          // only replace the value that was read, the apps may have refreshed the token in the meantime
          const result = await db
            .updateTable(from)
            .set({ [column]: encryptToken(decryptToken(value, aad), aad) })
            .where('id', '=', row.id)
            .where(column, '=', value)
            .executeTakeFirst();
          encrypted += Number(result.numUpdatedRows);
        }
      }
    }

    console.log(write ? `${table}: encrypted ${encrypted} of ${pending} tokens` : `${table}: ${pending} tokens to encrypt`);
  }

  if (!write) console.log('Dry run finished.');
} finally {
  await db.destroy();
}
