import fs from 'fs/promises';
import StreamConcat from './streamConcat';
import { createReadStream } from 'fs';
import path from 'path';

export const recPath = path.join(__dirname, '..', '..', '..', 'rec');

export interface RecordingInfo {
  format: 1;
  key: number | string;
  delete: number | string;
  guild: string;
  guildExtra: {
    name: string;
    id: string;
    icon: string | null;
  };
  channel: string;
  channelExtra: {
    name: string;
    id: string;
    type: number;
  };
  requester: string;
  requesterExtra: {
    username: string;
    discriminator: string;
    avatar: string | null;
  };
  requesterId: string;
  startTime: string;
  expiresAfter?: number;
  user?: string;
  userId?: string;
  userExtra?: {
    username: string;
    discriminator: string;
    avatar?: string;
  };
  features: { [features: string]: boolean };
}

export interface RecordingUser {
  id: string;
  username: string;
  discrim: string;
  avatar?: string;
}

export interface RecordingNote {
  time: string;
  note: string;
}

export async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    return false;
  }
}

export function getRawRecordingStream(id: string) {
  const stream = new StreamConcat(
    ['header1', 'header2', 'data'].map((ext) => createReadStream(path.join(recPath, `${id}.ogg.${ext}`)))
  );
  return stream;
}

export async function getRecording(id: string): Promise<RecordingInfo | false> {
  const dataExists = !(
    await Promise.all(['data', 'header1', 'header2'].map((ext) => fileExists(path.join(recPath, `${id}.ogg.${ext}`))))
  ).some((exists) => exists === false);
  const infoExists = await fileExists(path.join(recPath, `${id}.ogg.info`));
  if (!dataExists && infoExists) return false;
  if (!dataExists || !infoExists) return null;

  const info: Partial<RecordingInfo> = JSON.parse(await fs.readFile(path.join(recPath, `${id}.ogg.info`), 'utf8'));

  // check for a key file
  if (!info.key) {
    const keyExists = await fileExists(path.join(recPath, `${id}.ogg.key`));
    if (keyExists) info.key = await fs.readFile(path.join(recPath, `${id}.ogg.key`), 'utf8');
  }

  // fill in features
  if (!info.features) {
    const featsExists = await fileExists(path.join(recPath, `${id}.ogg.features`));
    if (featsExists) info.features = JSON.parse(await fs.readFile(path.join(recPath, `${id}.ogg.features`), 'utf8'));
    else info.features = {};
  }

  return info as RecordingInfo;
}

export async function deleteRecording(id: string): Promise<void> {
  const keyExists = await fileExists(path.join(recPath, `${id}.ogg.key`));
  const featsExists = await fileExists(path.join(recPath, `${id}.ogg.features`));
  await Promise.all(
    ['data', 'header1', 'header2', ...(keyExists ? ['key'] : []), ...(featsExists ? ['features'] : [])].map((ext) =>
      fs.unlink(path.join(recPath, `${id}.ogg.${ext}`))
    )
  );
}

export async function getUsers(id: string): Promise<RecordingUser[]> {
  const userText = await fs.readFile(path.join(recPath, `${id}.ogg.users`), 'utf8');
  const users: { [index: string]: RecordingUser } = JSON.parse(`{${userText}}`);
  return Object.values(users).filter((user) => Object.keys(user).length !== 0);
}

export function keyMatches(rec: RecordingInfo, key: string) {
  return key === String(rec.key);
}
