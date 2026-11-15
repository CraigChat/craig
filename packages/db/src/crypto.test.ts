import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { decryptToken, decryptTokens, encryptToken, encryptTokens, tokenAad, tokenPrefix } from './crypto.js';

const key = () => randomBytes(32).toString('base64');
const KEY_1 = key();
const KEY_2 = key();
const AAD = tokenAad('BoxUser', 'token', '123');

test.beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEYS = `1:${KEY_1}`;
});

test('round-trips with the e$k<version>: prefix', () => {
  const encrypted = encryptToken('tökén', AAD);
  assert.equal(AAD, 'BoxUser.token:123');
  assert.equal(tokenPrefix(), 'e$k1:');
  assert.match(encrypted, /^e\$k1:[\w-]+$/);
  assert.notEqual(encryptToken('tökén', AAD), encrypted);
  assert.equal(decryptToken(encrypted, AAD), 'tökén');
});

test('passes plaintext through', () => {
  assert.equal(decryptToken('plain-token', AAD), 'plain-token');
});

test('rejects another row, tampering and malformed values', () => {
  const encrypted = encryptToken('token', AAD);
  assert.throws(() => decryptToken(encrypted, tokenAad('BoxUser', 'token', '456')));
  assert.throws(() => decryptToken(encrypted, tokenAad('BoxUser', 'refreshToken', '123')));
  const flipped = encrypted.slice(0, -1) + (encrypted.endsWith('A') ? 'B' : 'A');
  assert.throws(() => decryptToken(flipped, AAD));
  assert.throws(() => decryptToken('e$k1:AAAA', AAD));
  assert.throws(() => decryptToken('e$k1:', AAD));
});

test('encrypts with the highest key version and still decrypts older ones', () => {
  const old = encryptToken('token', AAD);
  process.env.TOKEN_ENCRYPTION_KEYS = `1:${KEY_1},2:${KEY_2}`;
  assert.equal(tokenPrefix(), 'e$k2:');
  assert.ok(encryptToken('token', AAD).startsWith('e$k2:'));
  assert.equal(decryptToken(old, AAD), 'token');

  process.env.TOKEN_ENCRYPTION_KEYS = `2:${KEY_2}`;
  assert.throws(() => decryptToken(old, AAD), /version 1/);
});

test('rejects missing or invalid keys', () => {
  process.env.TOKEN_ENCRYPTION_KEYS = '';
  assert.throws(() => encryptToken('token', AAD), /not set/);
  process.env.TOKEN_ENCRYPTION_KEYS = '1:c2hvcnQ=';
  assert.throws(() => encryptToken('token', AAD), /32-byte/);
  process.env.TOKEN_ENCRYPTION_KEYS = `0:${KEY_1}`;
  assert.throws(() => encryptToken('token', AAD), /32-byte/);
});

test('encrypts and decrypts the token columns of a row', () => {
  const row = encryptTokens('GoogleDriveUser', '123', { token: 'access', refreshToken: null });
  assert.match(row.token, /^e\$k1:/);
  assert.equal(row.refreshToken, null);
  assert.deepEqual(decryptTokens('GoogleDriveUser', '123', row), { token: 'access', refreshToken: null });
  assert.throws(() => decryptTokens('GoogleDriveUser', '456', row));
  assert.deepEqual(encryptTokens('GoogleDriveUser', '123', {}), {});

  // rows written by the backfill script and plaintext rows read the same way
  const backfilled = { token: encryptToken('access', tokenAad('BoxUser', 'token', '123')), refreshToken: 'plain-refresh' };
  assert.deepEqual(decryptTokens('BoxUser', '123', backfilled), { token: 'access', refreshToken: 'plain-refresh' });
});
