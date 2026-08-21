import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { type FileHandle, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { cancel, intro, isCancel, note, outro, select, spinner } from '@clack/prompts';
import type { RecordingInfo, RecordingUser } from '@craig/types/recording';

export type UserId = string & { readonly __brand: 'UserId' };
export type RedactedUserId = string & { readonly __brand: 'RedactedUserId' };

type StoredRecordingUser = Omit<RecordingUser, 'track'>;

export type RedactedUsers = {
  text: string;
  targetTracks: Set<number>;
  alreadyRedactedTracks: Set<number>;
};

export type RedactedInfo = {
  text: string;
  changed: boolean;
  alreadyRedacted: boolean;
};

export type OggPage = {
  version: number;
  headerType: number;
  granule: bigint;
  serial: number;
  sequence: number;
  payload: Buffer;
  raw: Buffer;
};

type OggPageInput = Omit<OggPage, 'raw'>;

type TrackCodec = { kind: 'opus'; vadWrapped: boolean } | { kind: 'flac'; sampleRate: 44_100 | 48_000; vadWrapped: boolean };

const OGG_CRC_POLYNOMIAL = 0x04c11db7;
const OGG_CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < OGG_CRC_TABLE.length; n++) {
  let crc = n << 24;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ OGG_CRC_POLYNOMIAL : crc << 1;
  OGG_CRC_TABLE[n] = crc >>> 0;
}

const SILENT_OPUS_FRAME = Buffer.from([0xff, 0xfe]);
const SILENT_FLAC_48K = Buffer.from([0xff, 0xf8, 0x7a, 0x0c, 0x00, 0x03, 0xbf, 0x94, 0x00, 0x00, 0x00, 0x00, 0xb1, 0xca]);
const SILENT_FLAC_44K = Buffer.from([0xff, 0xf8, 0x79, 0x0c, 0x00, 0x03, 0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xc5]);
const RECORDING_EXTENSIONS = ['data', 'header1', 'header2', 'users', 'info', 'log'] as const;

export type RecordingRow = { id: string; userId: string; endedAt: Date | null };

export interface RecordingDatabase {
  findByRequesterIds(userIds: readonly string[]): Promise<RecordingRow[]>;
  findByIds(recordingIds: readonly string[]): Promise<RecordingRow[]>;
  redactRequester(recordingId: string, userId: string, redactedId: string): Promise<boolean>;
}

type PlannedRecording =
  | { kind: 'ready'; id: string; live: boolean; targetTracks: number[] }
  | { kind: 'already-redacted'; id: string; live: boolean; targetTracks: number[] }
  | { kind: 'database-only'; id: string; live: boolean; targetTracks: [] }
  | { kind: 'incomplete'; id: string; live: boolean; targetTracks: number[]; missing: string[] }
  | { kind: 'malformed'; id: string; live: boolean; targetTracks: number[]; error: string };

export type RedactionPlan = {
  userId: UserId;
  redactedId: RedactedUserId;
  recDirectory: string;
  recordings: PlannedRecording[];
};

export type ExecutionMode = 'completed-only' | 'include-live';
export type ExecutionResult =
  | { kind: 'redacted'; id: string }
  | { kind: 'already-redacted'; id: string }
  | { kind: 'skipped-live'; id: string }
  | { kind: 'skipped-incomplete'; id: string; error: string }
  | { kind: 'failed'; id: string; error: string };

export function parseUserId(value: string): UserId {
  if (!/^\d+$/.test(value)) throw new Error('Expected a numeric Discord user ID.');
  return value as UserId;
}

export function hashUserId(userId: UserId): RedactedUserId {
  const digest = createHash('sha256').update(userId, 'utf8').digest('hex');
  return `redacted:${digest.slice(-32)}` as RedactedUserId;
}

function redactIdentity(record: StoredRecordingUser, redactedId: RedactedUserId) {
  const redacted = { ...record };
  redacted.id = redactedId;
  redacted.username = '[redacted]';
  if ('globalName' in redacted) redacted.globalName = '[redacted]';
  redacted.discriminator = '0';
  delete redacted.avatar;
  delete redacted.avatarUrl;
  return redacted;
}

export function redactRecordingUsers(text: string, userId: UserId, redactedId: RedactedUserId): RedactedUsers {
  const users = JSON.parse(`{${text}}`) as Record<string, StoredRecordingUser>;
  const targetTracks = new Set<number>();
  const alreadyRedactedTracks = new Set<number>();

  for (const [trackText, value] of Object.entries(users)) {
    const track = Number.parseInt(trackText, 10);
    if (track === 0) continue;
    if (value.id === userId) {
      targetTracks.add(track);
      users[trackText] = redactIdentity(value, redactedId);
    } else if (value.id === redactedId) {
      alreadyRedactedTracks.add(track);
      users[trackText] = redactIdentity(value, redactedId);
    }
  }

  const serialized = Object.entries(users)
    .map(([track, value], index) => `${index === 0 ? '' : ','}"${track}":${JSON.stringify(value)}`)
    .join('\n');

  return { text: `${serialized}\n`, targetTracks, alreadyRedactedTracks };
}

export function redactRecordingInfo(text: string, userId: UserId, redactedId: RedactedUserId, markRedacted = false): RedactedInfo {
  const info = JSON.parse(text) as RecordingInfo;
  const alreadyRedacted = info.requesterId === redactedId;
  const redactRequester = info.requesterId === userId || alreadyRedacted;
  if (!redactRequester && !markRedacted) return { text, changed: false, alreadyRedacted: false };

  let redactedInfo: RecordingInfo = { ...info, redacted: true };
  if (redactRequester) {
    const { avatar: _, ...requesterExtra } = info.requesterExtra;
    redactedInfo = {
      ...redactedInfo,
      requesterId: redactedId,
      requester: '[redacted]',
      requesterExtra: {
        ...requesterExtra,
        username: '[redacted]',
        ...(requesterExtra.globalName === undefined ? {} : { globalName: '[redacted]' }),
        discriminator: '0'
      }
    };
  }

  const redactedText = `${JSON.stringify(redactedInfo)}\n`;
  return { text: redactedText, changed: redactedText !== text, alreadyRedacted };
}

function computeOggCrc(bytes: Buffer): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ OGG_CRC_TABLE[(crc >>> 24) ^ byte]!) >>> 0;
  return crc;
}

export function createOggPage(page: OggPageInput): Buffer {
  const segments: number[] = [];
  let remaining = page.payload.length;
  while (remaining > 0) {
    const length = Math.min(255, remaining);
    segments.push(length);
    remaining -= length;
  }
  if (segments.length === 0 || segments.at(-1) === 255) segments.push(0);
  if (segments.length > 255) throw new Error('Ogg packet is too large for one page.');

  const output = Buffer.alloc(27 + segments.length + page.payload.length);
  output.write('OggS', 0, 'ascii');
  output.writeUInt8(page.version, 4);
  output.writeUInt8(page.headerType, 5);
  output.writeBigUInt64LE(page.granule, 6);
  output.writeUInt32LE(page.serial, 14);
  output.writeUInt32LE(page.sequence, 18);
  output.writeUInt32LE(0, 22);
  output.writeUInt8(segments.length, 26);
  Buffer.from(segments).copy(output, 27);
  page.payload.copy(output, 27 + segments.length);
  output.writeUInt32LE(computeOggCrc(output), 22);
  return output;
}

export function parseOggPages(input: Uint8Array): OggPage[] {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const pages: OggPage[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 27 || bytes.toString('ascii', offset, offset + 4) !== 'OggS')
      throw new Error(`Malformed Ogg page at byte ${offset}.`);
    const segmentCount = bytes.readUInt8(offset + 26);
    const headerLength = 27 + segmentCount;
    if (bytes.length - offset < headerLength) throw new Error(`Truncated Ogg segment table at byte ${offset}.`);

    let payloadLength = 0;
    for (let index = 0; index < segmentCount; index++) payloadLength += bytes.readUInt8(offset + 27 + index);
    const pageLength = headerLength + payloadLength;
    if (bytes.length - offset < pageLength) throw new Error(`Truncated Ogg payload at byte ${offset}.`);
    if (segmentCount === 0 || bytes.readUInt8(offset + headerLength - 1) === 255)
      throw new Error(`Ogg page at byte ${offset} does not contain one complete packet.`);

    const raw = Buffer.from(bytes.subarray(offset, offset + pageLength));
    pages.push({
      version: raw.readUInt8(4),
      headerType: raw.readUInt8(5),
      granule: raw.readBigUInt64LE(6),
      serial: raw.readUInt32LE(14),
      sequence: raw.readUInt32LE(18),
      payload: raw.subarray(headerLength),
      raw
    });
    offset += pageLength;
  }

  return pages;
}

function startsWith(bytes: Uint8Array, prefix: string): boolean {
  return bytes.length >= prefix.length && Buffer.from(bytes.subarray(0, prefix.length)).toString('binary') === prefix;
}

function detectCodecs(headers: Uint8Array, targetTracks: Set<number>): Map<number, TrackCodec> {
  const codecs = new Map<number, TrackCodec>();
  for (const page of parseOggPages(headers)) {
    if (!targetTracks.has(page.serial) || codecs.has(page.serial)) continue;
    let payload = page.payload;
    let vadWrapped = false;
    if (startsWith(payload, 'ECVADD')) {
      if (payload.length < 8) throw new Error(`Track ${page.serial} has a malformed VAD header.`);
      const audioOffset = 8 + payload.readUInt16LE(6);
      if (audioOffset >= payload.length) throw new Error(`Track ${page.serial} has a malformed VAD header.`);
      payload = payload.subarray(audioOffset);
      vadWrapped = true;
    }

    if (startsWith(payload, 'Opus')) {
      codecs.set(page.serial, { kind: 'opus', vadWrapped });
    } else if (startsWith(payload, '\x7fFLAC')) {
      if (payload.length <= 29) throw new Error(`Track ${page.serial} has a truncated FLAC header.`);
      const sampleRate = (payload[27]! << 12) + (payload[28]! << 4) + (payload[29]! >> 4);
      if (sampleRate !== 44_100 && sampleRate !== 48_000) throw new Error(`Track ${page.serial} uses unsupported FLAC sample rate ${sampleRate}.`);
      codecs.set(page.serial, { kind: 'flac', sampleRate, vadWrapped });
    }
  }

  for (const track of targetTracks) if (!codecs.has(track)) throw new Error(`No supported audio header found for track ${track}.`);
  return codecs;
}

function getOpusDurationSamples(packet: Buffer): number {
  if (packet.length === 0) throw new Error('Cannot determine duration of an empty Opus packet.');
  const frameCode = packet[0]! & 3;
  let frameCount: number;
  if (frameCode === 0) frameCount = 1;
  else if (frameCode === 1 || frameCode === 2) frameCount = 2;
  else {
    if (packet.length < 2) throw new Error('Cannot determine duration of a malformed Opus packet.');
    frameCount = packet[1]! & 0x3f;
  }

  const config = packet[0]! >> 3;
  let frameSize: number;
  if ([0, 4, 8, 12, 14, 18, 22, 26, 30].includes(config)) frameSize = 480;
  else if ([2, 6, 10].includes(config)) frameSize = 1_920;
  else if ([3, 7, 11].includes(config)) frameSize = 2_880;
  else if ([17, 21, 25, 29].includes(config)) frameSize = 240;
  else if ([16, 20, 24, 28].includes(config)) frameSize = 120;
  else frameSize = 960;
  return frameCount * frameSize;
}

function createSilentOpusPacket(original: Buffer): Buffer {
  const duration = getOpusDurationSamples(original);
  if (duration % 960 !== 0 || duration < 960 || duration > 5_760) throw new Error(`Unsupported Opus packet duration of ${duration} samples.`);
  const frames = duration / 960;
  if (frames === 1) return Buffer.concat([Buffer.from([0xf8]), SILENT_OPUS_FRAME]);
  if (frames === 2) return Buffer.concat([Buffer.from([0xf9]), SILENT_OPUS_FRAME, SILENT_OPUS_FRAME]);
  return Buffer.concat([Buffer.from([0xfb, frames]), ...Array.from({ length: frames }, () => SILENT_OPUS_FRAME)]);
}

function silencePayload(payload: Buffer, codec: TrackCodec): Buffer {
  const audio = codec.vadWrapped ? payload.subarray(1) : payload;
  if (audio.length === 0) return payload;
  const silence = codec.kind === 'opus' ? createSilentOpusPacket(audio) : codec.sampleRate === 44_100 ? SILENT_FLAC_44K : SILENT_FLAC_48K;
  return codec.vadWrapped ? Buffer.concat([Buffer.from([0]), silence]) : silence;
}

export function rewriteOggData(data: Uint8Array, headers: Uint8Array, targetTracks: Set<number>): Buffer {
  const codecs = detectCodecs(headers, targetTracks);
  const output: Buffer[] = [];
  for (const page of parseOggPages(data)) {
    const codec = codecs.get(page.serial);
    if (!codec || page.payload.length === 0) {
      output.push(page.raw);
      continue;
    }
    output.push(createOggPage({ ...page, payload: silencePayload(page.payload, codec) }));
  }
  return Buffer.concat(output);
}

async function readBytes(handle: FileHandle, length: number, position: number, allowEof = false): Promise<Buffer | null> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      if (allowEof && offset === 0) return null;
      throw new Error(`Truncated Ogg page at byte ${position}.`);
    }
    offset += bytesRead;
  }
  return buffer;
}

async function writeBytes(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (bytesWritten === 0) throw new Error('Could not write Ogg output.');
    offset += bytesWritten;
  }
}

export async function rewriteOggFile(options: {
  source: string;
  destination: string;
  headers: Uint8Array;
  targetTracks: Set<number>;
  onProgress?: (processedBytes: number, totalBytes: number) => void;
}): Promise<void> {
  const codecs = detectCodecs(options.headers, options.targetTracks);
  const input = await open(options.source, 'r');
  let output: FileHandle | undefined;
  try {
    output = await open(options.destination, 'wx');
    const totalBytes = (await input.stat()).size;
    let position = 0;
    let lastReported = 0;
    options.onProgress?.(0, totalBytes);
    while (true) {
      const header = await readBytes(input, 27, position, true);
      if (header === null) break;
      if (header.toString('ascii', 0, 4) !== 'OggS') throw new Error(`Malformed Ogg page at byte ${position}.`);
      const segmentCount = header.readUInt8(26);
      if (segmentCount === 0) throw new Error(`Ogg page at byte ${position} has no lacing values.`);
      const lacing = await readBytes(input, segmentCount, position + 27);
      if (lacing === null) throw new Error(`Truncated Ogg segment table at byte ${position}.`);
      if (lacing.at(-1) === 255) throw new Error(`Ogg page at byte ${position} does not contain one complete packet.`);
      let payloadLength = 0;
      for (const length of lacing) payloadLength += length;
      const payload = await readBytes(input, payloadLength, position + 27 + segmentCount);
      if (payload === null) throw new Error(`Truncated Ogg payload at byte ${position}.`);
      const raw = Buffer.concat([header, lacing, payload]);
      const page = parseOggPages(raw)[0]!;
      const codec = codecs.get(page.serial);
      const rewritten = codec && page.payload.length > 0 ? createOggPage({ ...page, payload: silencePayload(page.payload, codec) }) : page.raw;
      await writeBytes(output, rewritten);
      position += raw.length;
      if (position - lastReported >= 1024 * 1024 || position === totalBytes) {
        options.onProgress?.(position, totalBytes);
        lastReported = position;
      }
    }
    await output.sync();
  } finally {
    await Promise.all([input.close(), output?.close()]);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordingBase(recDirectory: string, id: string): string {
  return join(recDirectory, `${id}.ogg`);
}

function matchingTrackNumbers(result: RedactedUsers): number[] {
  return [...new Set([...result.targetTracks, ...result.alreadyRedactedTracks])].sort((a, b) => a - b);
}

export async function createRedactionPlan(options: { userId: UserId; recDirectory: string; database: RecordingDatabase }): Promise<RedactionPlan> {
  const redactedId = hashUserId(options.userId);
  const files = await readdir(options.recDirectory);
  const filesByRecording = new Map<string, Set<string>>();
  for (const file of files) {
    const match = /^(.*)\.ogg\.(data|header1|header2|users|info|log)$/.exec(file);
    if (!match) continue;
    const id = match[1]!;
    const extension = match[2]!;
    const extensions = filesByRecording.get(id) ?? new Set<string>();
    extensions.add(extension);
    filesByRecording.set(id, extensions);
  }

  const requesterRows = await options.database.findByRequesterIds([options.userId, redactedId]);
  const rowsById = new Map(requesterRows.map((row) => [row.id, row]));
  const candidates = new Set(requesterRows.map((row) => row.id));

  for (const [id, extensions] of filesByRecording) {
    const base = recordingBase(options.recDirectory, id);
    try {
      if (extensions.has('users')) {
        const users = redactRecordingUsers(await readFile(`${base}.users`, 'utf8'), options.userId, redactedId);
        if (users.targetTracks.size > 0 || users.alreadyRedactedTracks.size > 0) candidates.add(id);
      }
      if (extensions.has('info')) {
        const info = redactRecordingInfo(await readFile(`${base}.info`, 'utf8'), options.userId, redactedId);
        if (info.changed || info.alreadyRedacted) candidates.add(id);
      }
    } catch {
      if (rowsById.has(id)) candidates.add(id);
    }
  }

  for (const row of await options.database.findByIds([...candidates])) rowsById.set(row.id, row);

  const recordings: PlannedRecording[] = [];
  for (const id of [...candidates].sort()) {
    const row = rowsById.get(id);
    const live = row?.endedAt === null;
    const extensions = filesByRecording.get(id) ?? new Set<string>();
    if (extensions.size === 0) {
      recordings.push({ kind: row?.userId === redactedId ? 'already-redacted' : 'database-only', id, live, targetTracks: [] });
      continue;
    }

    const missing = RECORDING_EXTENSIONS.filter((extension) => !extensions.has(extension));
    if (missing.length > 0) {
      recordings.push({ kind: 'incomplete', id, live, targetTracks: [], missing: [...missing] });
      continue;
    }

    const base = recordingBase(options.recDirectory, id);
    try {
      const [usersText, infoText] = await Promise.all([readFile(`${base}.users`, 'utf8'), readFile(`${base}.info`, 'utf8')]);
      const users = redactRecordingUsers(usersText, options.userId, redactedId);
      const targetTracks = matchingTrackNumbers(users);
      const info = redactRecordingInfo(infoText, options.userId, redactedId, targetTracks.length > 0);
      const needsFileWork = users.text !== usersText || info.changed;
      const needsDatabaseWork = row?.userId === options.userId;
      recordings.push({ kind: needsFileWork || needsDatabaseWork ? 'ready' : 'already-redacted', id, live, targetTracks });
    } catch (error) {
      recordings.push({ kind: 'malformed', id, live, targetTracks: [], error: errorMessage(error) });
    }
  }

  return { userId: options.userId, redactedId, recDirectory: options.recDirectory, recordings };
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

async function executeFileRedaction(
  plan: RedactionPlan,
  recording: Extract<PlannedRecording, { kind: 'ready' }>,
  onProgress?: (processedBytes: number, totalBytes: number) => void
): Promise<void> {
  const base = recordingBase(plan.recDirectory, recording.id);
  const [usersText, infoText, headers] = await Promise.all([
    readFile(`${base}.users`, 'utf8'),
    readFile(`${base}.info`, 'utf8'),
    readFile(`${base}.header1`)
  ]);
  const users = redactRecordingUsers(usersText, plan.userId, plan.redactedId);
  const info = redactRecordingInfo(infoText, plan.userId, plan.redactedId, matchingTrackNumbers(users).length > 0);
  const suffix = `.redact-${process.pid}-${randomUUID()}`;
  const dataTemp = `${base}.data${suffix}`;
  const usersTemp = `${base}.users${suffix}`;
  const infoTemp = `${base}.info${suffix}`;
  const temps: string[] = [];

  try {
    if (users.targetTracks.size > 0) {
      await rewriteOggFile({ source: `${base}.data`, destination: dataTemp, headers, targetTracks: users.targetTracks, onProgress });
      temps.push(dataTemp);
    }
    if (users.text !== usersText) {
      const handle = await open(usersTemp, 'wx');
      try {
        await handle.writeFile(users.text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      temps.push(usersTemp);
    }
    if (info.changed) {
      const handle = await open(infoTemp, 'wx');
      try {
        await handle.writeFile(info.text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      temps.push(infoTemp);
    }

    if (temps.includes(dataTemp)) await rename(dataTemp, `${base}.data`);
    if (temps.includes(usersTemp)) await rename(usersTemp, `${base}.users`);
    if (temps.includes(infoTemp)) await rename(infoTemp, `${base}.info`);
  } finally {
    await Promise.all([dataTemp, usersTemp, infoTemp].map(removeIfPresent));
  }
}

export async function executeRedactionPlan(options: {
  plan: RedactionPlan;
  mode: ExecutionMode;
  database: RecordingDatabase;
  onProgress?: (recordingId: string, processedBytes: number, totalBytes: number) => void;
}): Promise<{ results: ExecutionResult[] }> {
  const results: ExecutionResult[] = [];
  for (const recording of options.plan.recordings) {
    if (recording.live && options.mode === 'completed-only') {
      results.push({ kind: 'skipped-live', id: recording.id });
      continue;
    }
    if (recording.kind === 'already-redacted') {
      results.push({ kind: 'already-redacted', id: recording.id });
      continue;
    }
    if (recording.kind === 'incomplete') {
      results.push({ kind: 'skipped-incomplete', id: recording.id, error: `Missing ${recording.missing.join(', ')}` });
      continue;
    }
    if (recording.kind === 'malformed') {
      results.push({ kind: 'failed', id: recording.id, error: recording.error });
      continue;
    }

    try {
      if (recording.kind === 'ready') {
        await executeFileRedaction(options.plan, recording, (processedBytes, totalBytes) =>
          options.onProgress?.(recording.id, processedBytes, totalBytes)
        );
      }
      await options.database.redactRequester(recording.id, options.plan.userId, options.plan.redactedId);
      results.push({ kind: 'redacted', id: recording.id });
    } catch (error) {
      results.push({ kind: 'failed', id: recording.id, error: errorMessage(error) });
    }
  }
  return { results };
}

export function reportExitCode(report: { results: ExecutionResult[] }): number {
  return report.results.some((result) => result.kind === 'failed' || result.kind === 'skipped-incomplete') ? 1 : 0;
}

function formatPlan(plan: RedactionPlan): string {
  if (plan.recordings.length === 0) return 'No matching recordings found.';
  return plan.recordings
    .map((recording) => {
      const live = recording.live ? ' [LIVE]' : '';
      const tracks = recording.targetTracks.length > 0 ? `, tracks ${recording.targetTracks.join(', ')}` : '';
      if (recording.kind === 'incomplete') return `${recording.id}${live}: incomplete, missing ${recording.missing.join(', ')}`;
      if (recording.kind === 'malformed') return `${recording.id}${live}: malformed, ${recording.error}`;
      return `${recording.id}${live}: ${recording.kind}${tracks}`;
    })
    .join('\n');
}

function formatReport(report: { results: ExecutionResult[] }): string {
  const counts = new Map<ExecutionResult['kind'], number>();
  for (const result of report.results) counts.set(result.kind, (counts.get(result.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => `${kind}: ${count}`).join(', ');
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function chooseExecutionMode(plan: RedactionPlan): Promise<ExecutionMode | null> {
  const hasLive = plan.recordings.some((recording) => recording.live && recording.kind !== 'already-redacted');
  const choice = await select<ExecutionMode | 'cancel'>({
    message: 'Choose which recordings to redact',
    options: hasLive
      ? [
          { value: 'completed-only', label: 'Redact completed recordings only' },
          { value: 'include-live', label: 'Redact completed and live recordings', hint: 'unsafe: active writers may race with this command' },
          { value: 'cancel', label: 'Cancel' }
        ]
      : [
          { value: 'completed-only', label: 'Redact recordings' },
          { value: 'cancel', label: 'Cancel' }
        ]
  });
  if (isCancel(choice) || choice === 'cancel') return null;
  return choice;
}

async function main(): Promise<number> {
  intro('Redact recording user');
  const input = process.argv[2];
  if (!input || process.argv.length > 3) throw new Error('Usage: pnpm redact-user <user-id>');
  const userId = parseUserId(input);
  const recDirectory = fileURLToPath(new URL(process.env.REC_DIRECTORY || '../rec', import.meta.url));
  const { prisma } = await import('@craig/db');
  const database: RecordingDatabase = {
    async findByRequesterIds(userIds) {
      return prisma.recording.findMany({
        where: { userId: { in: [...userIds] } },
        select: { id: true, userId: true, endedAt: true }
      });
    },
    async findByIds(recordingIds) {
      if (recordingIds.length === 0) return [];
      return prisma.recording.findMany({
        where: { id: { in: [...recordingIds] } },
        select: { id: true, userId: true, endedAt: true }
      });
    },
    async redactRequester(recordingId, originalUserId, redactedId) {
      const result = await prisma.recording.updateMany({
        where: { id: recordingId, userId: originalUserId },
        data: { userId: redactedId }
      });
      return result.count > 0;
    }
  };

  try {
    const plan = await createRedactionPlan({ userId, recDirectory, database });
    note(formatPlan(plan), `Affected recordings for ${plan.redactedId}`);
    if (plan.recordings.length === 0) {
      outro('Nothing to redact.');
      return 0;
    }

    const mode = await chooseExecutionMode(plan);
    if (mode === null) {
      cancel('Operation cancelled.');
      return 0;
    }

    const progress = spinner();
    progress.start('Redacting recordings');
    const report = await executeRedactionPlan({
      plan,
      mode,
      database,
      onProgress(recordingId, processedBytes, totalBytes) {
        progress.message(
          `${recordingId} — ${formatBytes(processedBytes)} / ${formatBytes(totalBytes)} (${formatBytes(totalBytes - processedBytes)} left)`
        );
      }
    });
    progress.stop('Redaction run finished');
    const exitCode = reportExitCode(report);
    if (exitCode === 0) outro(formatReport(report));
    else cancel(formatReport(report));
    return exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      cancel(errorMessage(error));
      process.exitCode = 1;
    });
}
