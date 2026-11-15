import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { DB } from '../.kysely/types.js';

// Stored format: e$k<key version>:<base64url(iv ‖ ciphertext ‖ auth tag)>, AES-256-GCM
const PREFIX = /^e\$k(\d+):/;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKeyring() {
  const keys = new Map<number, Buffer>();
  for (const entry of (process.env.TOKEN_ENCRYPTION_KEYS ?? '').split(',').filter(Boolean)) {
    const [version = '', encoded = ''] = entry.split(':');
    const key = Buffer.from(encoded, 'base64');
    if (!/^[1-9]\d*$/.test(version) || key.length !== 32)
      throw new Error('TOKEN_ENCRYPTION_KEYS entries must look like "<version>:<base64 32-byte key>".');
    keys.set(Number(version), key);
  }
  if (keys.size === 0) throw new Error('TOKEN_ENCRYPTION_KEYS is not set.');

  return { current: Math.max(...keys.keys()), keys };
}

/** Will throw early if the keyring is messed up */
export function assertTokenEncryptionKeys() {
  getKeyring();
}

export function tokenPrefix() {
  return `e$k${getKeyring().current}:`;
}

export function tokenAad<T extends keyof DB>(table: T, column: keyof DB[T] & string, id: string) {
  return `${table}.${column}:${id}`;
}

type TokenColumns<T extends keyof DB> = { [K in keyof DB[T] & string]?: string | null };

function mapTokens<V extends object>(map: typeof encryptToken, table: string, id: string, tokens: V) {
  return Object.fromEntries(
    Object.entries(tokens).map(([column, value]) => [column, typeof value === 'string' ? map(value, `${table}.${column}:${id}`) : value])
  ) as V;
}

export function encryptTokens<T extends keyof DB, V extends TokenColumns<T>>(table: T, id: string, tokens: V) {
  return mapTokens(encryptToken, table, id, tokens);
}

export function decryptTokens<T extends keyof DB, V extends TokenColumns<T>>(table: T, id: string, tokens: V) {
  return mapTokens(decryptToken, table, id, tokens);
}

export function encryptToken(plaintext: string, aad: string) {
  const { current, keys } = getKeyring();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keys.get(current)!, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `e$k${current}:${data.toString('base64url')}`;
}

export function decryptToken(value: string, aad: string) {
  const match = PREFIX.exec(value);
  if (!match) return value;

  const key = getKeyring().keys.get(Number(match[1]));
  if (!key) throw new Error(`No token encryption key for version ${match[1]}.`);
  const data = Buffer.from(value.slice(match[0].length), 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_LENGTH), { authTagLength: TAG_LENGTH });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(data.subarray(-TAG_LENGTH));
  return Buffer.concat([decipher.update(data.subarray(IV_LENGTH, -TAG_LENGTH)), decipher.final()]).toString('utf8');
}
