import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { RecordingInfo } from '@craig/types/recording';

import {
  createOggPage,
  createRedactionPlan,
  executeRedactionPlan,
  hashUserId,
  parseOggPages,
  parseUserId,
  type RecordingDatabase,
  type RecordingRow,
  redactRecordingInfo,
  redactRecordingUsers,
  reportExitCode,
  rewriteOggData,
  rewriteOggFile
} from './redactUser.mjs';

const USER_ID = '123456789012345678';
const EXPECTED_REDACTED_ID = 'redacted:5d9aa320fa3455a5b4fa7b079427cf97';
const REDACTED_ID = hashUserId(parseUserId(USER_ID));

function recordingInfo(requesterId = USER_ID): RecordingInfo {
  return {
    format: 1,
    key: 'access-key',
    delete: 'delete-key',
    autorecorded: false,
    clientId: 'client-id',
    guild: 'guild-id',
    guildExtra: { id: 'guild-id', name: 'Guild' },
    channel: 'channel-id',
    channelExtra: { id: 'channel-id', name: 'Voice', type: 2 },
    requesterId,
    requester: 'Alice#1234',
    requesterExtra: { username: 'Alice', globalName: 'Alice Example', discriminator: '1234', avatar: 'avatar-hash' },
    startTime: '2026-08-21T00:00:00.000Z',
    expiresAfter: 24,
    features: { mix: true }
  };
}

test('hashUserId uses the latter half of a lowercase SHA-256 digest', () => {
  assert.equal(hashUserId(parseUserId(USER_ID)), EXPECTED_REDACTED_ID);
});

test('parseUserId rejects non-numeric input', () => {
  assert.throws(() => parseUserId('not-a-user'), /numeric Discord user ID/);
});

test('redactRecordingUsers removes identifying fields from every matching track', () => {
  const source =
    '"0":{}\n' +
    `,"1":{"id":"${USER_ID}","username":"Alice","globalName":"Alice Example","discriminator":"1234","unknown":false,"avatar":"data:image/png;base64,abc","avatarUrl":"https://cdn.example/avatar","bot":false}\n` +
    ',"2":{"id":"222222222222222222","username":"Bob","discriminator":"0","unknown":false}\n' +
    `,"3":{"id":"${USER_ID}","username":"Alice again","discriminator":"1234","unknown":false}\n`;

  const result = redactRecordingUsers(source, parseUserId(USER_ID), REDACTED_ID);

  assert.deepEqual(result.targetTracks, new Set([1, 3]));
  assert.match(result.text, /"id":"redacted:5d9aa320fa3455a5b4fa7b079427cf97"/);
  assert.doesNotMatch(result.text, /Alice|avatar/);
  assert.match(result.text, /"username":"\[redacted\]"/);
  assert.match(result.text, /"globalName":"\[redacted\]"/);
  assert.match(result.text, /"discriminator":"0"/);
  assert.match(result.text, /"username":"Bob"/);
});

test('redactRecordingUsers finishes metadata redaction for an already-hashed track', () => {
  const source = `"0":{}\n,"1":{"id":"${REDACTED_ID}","username":"Alice","discriminator":"1234","unknown":false,"avatar":"secret"}\n`;
  const result = redactRecordingUsers(source, parseUserId(USER_ID), REDACTED_ID);
  assert.match(result.text, /\[redacted\]/);
  assert.doesNotMatch(result.text, /Alice|secret/);
  assert.deepEqual(result.alreadyRedactedTracks, new Set([1]));
});

test('redactRecordingInfo redacts requester metadata and preserves unrelated fields', () => {
  const source = JSON.stringify(recordingInfo());

  const result = redactRecordingInfo(source, parseUserId(USER_ID), REDACTED_ID);
  const info = JSON.parse(result.text);

  assert.equal(result.changed, true);
  assert.equal(info.requesterId, REDACTED_ID);
  assert.equal(info.requester, '[redacted]');
  assert.deepEqual(info.requesterExtra, {
    username: '[redacted]',
    globalName: '[redacted]',
    discriminator: '0'
  });
  assert.equal(info.key, 'access-key');
  assert.equal(info.delete, 'delete-key');
  assert.equal(info.guild, 'guild-id');
});

function page(serial: number, sequence: number, granule: bigint, payload: number[], headerType = 0) {
  return createOggPage({ version: 0, serial, sequence, granule, headerType, payload: Buffer.from(payload) });
}

function opusHeader(vad = false) {
  const opus = [...Buffer.from('OpusHead'), 1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0];
  return vad ? [...Buffer.from('ECVADD'), 3, 0, 0, 3, 1, ...opus] : opus;
}

function flacHeader(sampleRate: 44_100 | 48_000) {
  const header = new Array<number>(52).fill(0);
  header.splice(0, 5, ...Buffer.from('\x7fFLAC'));
  header[27] = sampleRate >> 12;
  header[28] = (sampleRate >> 4) & 0xff;
  header[29] = (sampleRate & 0x0f) << 4;
  return header;
}

test('rewriteOggData replaces target Opus packets with duration-equivalent silence', () => {
  const headers = Buffer.concat([page(1, 0, 0n, opusHeader()), page(2, 0, 0n, opusHeader())]);
  const targetVoice = page(1, 2, 1_920n, [0xf9, 1, 2, 3, 4]);
  const timestamp = page(1, 3, 123n, []);
  const otherVoice = page(2, 2, 960n, [0xf8, 8, 9]);
  const data = Buffer.concat([targetVoice, timestamp, otherVoice]);

  const rewritten = rewriteOggData(data, headers, new Set([1]));
  const pages = parseOggPages(rewritten);

  assert.deepEqual([...pages[0]!.payload], [0xf9, 0xff, 0xfe, 0xff, 0xfe]);
  assert.equal(pages[0]!.granule, 1_920n);
  assert.deepEqual([...pages[1]!.payload], []);
  assert.deepEqual(pages[2]!.raw, otherVoice);
});

test('rewriteOggData supports VAD Opus and both FLAC sample rates', () => {
  const headers = Buffer.concat([page(1, 0, 0n, opusHeader(true)), page(2, 0, 0n, flacHeader(44_100)), page(3, 0, 0n, flacHeader(48_000))]);
  const data = Buffer.concat([page(1, 2, 960n, [75, 0xf8, 1, 2]), page(2, 2, 960n, [1, 2, 3]), page(3, 2, 960n, [4, 5, 6])]);

  const rewritten = rewriteOggData(data, headers, new Set([1, 2, 3]));
  const pages = parseOggPages(rewritten);

  assert.deepEqual([...pages[0]!.payload], [0, 0xf8, 0xff, 0xfe]);
  assert.deepEqual([...pages[1]!.payload], [0xff, 0xf8, 0x79, 0x0c, 0, 3, 0x71, 0x56, 0, 0, 0, 0, 0x63, 0xc5]);
  assert.deepEqual([...pages[2]!.payload], [0xff, 0xf8, 0x7a, 0x0c, 0, 3, 0xbf, 0x94, 0, 0, 0, 0, 0xb1, 0xca]);
});

test('rewriteOggData rejects unsupported Opus durations and malformed pages', () => {
  const headers = page(1, 0, 0n, opusHeader());
  assert.throws(() => rewriteOggData(page(1, 2, 480n, [0xf0, 1, 2]), headers, new Set([1])), /duration/);
  assert.throws(() => rewriteOggData(Buffer.from('not ogg'), headers, new Set([1])), /Ogg/);
});

test('rewriteOggFile rewrites a recording through a separate output file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'craig-redact-ogg-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.ogg');
  const destination = join(directory, 'destination.ogg');
  const headers = page(1, 0, 0n, opusHeader());
  await writeFile(source, Buffer.concat([page(1, 2, 960n, [0xf8, 1, 2]), page(1, 3, 10n, [])]));

  await rewriteOggFile({ source, destination, headers, targetTracks: new Set([1]) });

  const pages = parseOggPages(await readFile(destination));
  assert.deepEqual([...pages[0]!.payload], [0xf8, 0xff, 0xfe]);
  assert.deepEqual([...pages[1]!.payload], []);
});

class FakeDatabase implements RecordingDatabase {
  constructor(readonly rows: RecordingRow[]) {}

  async findByRequesterIds(userIds: readonly string[]) {
    return this.rows.filter((row) => userIds.includes(row.userId));
  }

  async findByIds(recordingIds: readonly string[]) {
    return this.rows.filter((row) => recordingIds.includes(row.id));
  }

  async redactRequester(recordingId: string, userId: string, redactedId: string) {
    const row = this.rows.find((candidate) => candidate.id === recordingId && candidate.userId === userId);
    if (!row) return false;
    row.userId = redactedId;
    return true;
  }
}

async function writeRecording(directory: string, id: string) {
  const base = join(directory, `${id}.ogg`);
  await Promise.all([
    writeFile(`${base}.header1`, page(1, 0, 0n, opusHeader())),
    writeFile(`${base}.header2`, page(1, 1, 0n, [...Buffer.from('OpusTags')])),
    writeFile(`${base}.data`, page(1, 2, 960n, [0xf8, 1, 2])),
    writeFile(
      `${base}.users`,
      `"0":{}\n,"1":{"id":"${USER_ID}","username":"Alice","globalName":"Alice Example","discriminator":"1234","unknown":false,"avatar":"secret"}\n`
    ),
    writeFile(`${base}.info`, JSON.stringify(recordingInfo())),
    writeFile(`${base}.log`, `User ${USER_ID} was Alice`)
  ]);
}

test('planning classifies completed, live, and expired database-only recordings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'craig-redact-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeRecording(directory, 'completed');
  await writeRecording(directory, 'live');
  const database = new FakeDatabase([
    { id: 'completed', userId: USER_ID, endedAt: new Date() },
    { id: 'live', userId: USER_ID, endedAt: null },
    { id: 'expired', userId: USER_ID, endedAt: new Date() }
  ]);

  const plan = await createRedactionPlan({ userId: parseUserId(USER_ID), recDirectory: directory, database });

  assert.deepEqual(
    plan.recordings.map(({ id, kind }) => [id, kind]),
    [
      ['completed', 'ready'],
      ['expired', 'database-only'],
      ['live', 'ready']
    ]
  );
  assert.equal(plan.recordings.find(({ id }) => id === 'live')?.live, true);
});

test('planning identifies a live recording where the target is only a participant', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'craig-redact-live-participant-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeRecording(directory, 'participant-live');
  const database = new FakeDatabase([{ id: 'participant-live', userId: '999999999999999999', endedAt: null }]);

  const plan = await createRedactionPlan({ userId: parseUserId(USER_ID), recDirectory: directory, database });

  assert.equal(plan.recordings[0]?.id, 'participant-live');
  assert.equal(plan.recordings[0]?.live, true);
});

test('execution redacts completed files and database-only rows while skipping live recordings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'craig-redact-execute-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeRecording(directory, 'completed');
  await writeRecording(directory, 'live');
  const database = new FakeDatabase([
    { id: 'completed', userId: USER_ID, endedAt: new Date() },
    { id: 'live', userId: USER_ID, endedAt: null },
    { id: 'expired', userId: USER_ID, endedAt: new Date() }
  ]);
  const plan = await createRedactionPlan({ userId: parseUserId(USER_ID), recDirectory: directory, database });

  const report = await executeRedactionPlan({ plan, mode: 'completed-only', database });

  assert.deepEqual(
    report.results.map(({ id, kind }) => [id, kind]),
    [
      ['completed', 'redacted'],
      ['expired', 'redacted'],
      ['live', 'skipped-live']
    ]
  );
  assert.equal(database.rows.find(({ id }) => id === 'completed')?.userId, REDACTED_ID);
  assert.equal(database.rows.find(({ id }) => id === 'expired')?.userId, REDACTED_ID);
  assert.equal(database.rows.find(({ id }) => id === 'live')?.userId, USER_ID);

  const users = await readFile(join(directory, 'completed.ogg.users'), 'utf8');
  const info = await readFile(join(directory, 'completed.ogg.info'), 'utf8');
  const log = await readFile(join(directory, 'completed.ogg.log'), 'utf8');
  const audio = parseOggPages(await readFile(join(directory, 'completed.ogg.data')));
  assert.match(users, /\[redacted\]/);
  assert.doesNotMatch(users, /Alice|secret/);
  assert.equal(JSON.parse(info).requesterId, REDACTED_ID);
  assert.equal(log, `User ${USER_ID} was Alice`);
  assert.deepEqual([...audio[0]!.payload], [0xf8, 0xff, 0xfe]);

  const repeated = await createRedactionPlan({ userId: parseUserId(USER_ID), recDirectory: directory, database });
  assert.equal(repeated.recordings.find(({ id }) => id === 'completed')?.kind, 'already-redacted');
});

test('reportExitCode fails only when selected work could not be redacted', () => {
  assert.equal(
    reportExitCode({
      results: [
        { kind: 'redacted', id: 'one' },
        { kind: 'skipped-live', id: 'two' }
      ]
    }),
    0
  );
  assert.equal(reportExitCode({ results: [{ kind: 'failed', id: 'one', error: 'bad Ogg' }] }), 1);
  assert.equal(reportExitCode({ results: [{ kind: 'skipped-incomplete', id: 'one', error: 'missing data' }] }), 1);
});
