import fs from 'node:fs/promises';
import { join } from 'node:path';

import type { RecordingInfo, RecordingNote, RecordingUser } from '@craig/types/recording';

import { REC_DIRECTORY } from './config.js';
import { convertToTimeMark } from './index.js';

export async function pathExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
}

export async function recordingExists(recordingId: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);
  const [infoExists, usersExists, dataExists] = await Promise.all([
    pathExists(`${recFileBase}.info`),
    pathExists(`${recFileBase}.users`),
    pathExists(`${recFileBase}.data`)
  ]);

  return { available: infoExists && usersExists, dataExists };
}

export async function getRecordingInfo(recordingId: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);
  const [info, users] = await Promise.all([
    (async () => {
      const data = await fs.readFile(`${recFileBase}.info`, { encoding: 'utf8' });
      return JSON.parse(data) as RecordingInfo;
    })(),
    (async () => {
      const data = await fs.readFile(`${recFileBase}.users`, { encoding: 'utf8' });
      const userRecord = JSON.parse(`{${data}}`) as Record<number, RecordingUser>;
      return Object.entries(userRecord)
        .map(([i, user]) => ({ ...user, track: parseInt(i) }))
        .filter((u) => u.track !== 0);
    })()
  ]);

  return { info, users };
}

export async function validateKey(recordingId: string, key: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);

  const data = await fs.readFile(`${recFileBase}.info`, { encoding: 'utf8' });
  const info = JSON.parse(data) as RecordingInfo;

  return info.key === key;
}

export async function getInfoText(id: string, info: RecordingInfo, users: RecordingUser[], notes?: RecordingNote[]) {
  let txt =
    'Recording ' +
    id +
    '\r\n' +
    '\r\n' +
    'Guild:\t\t' +
    (info.guildExtra ? `${info.guildExtra.name} (${info.guildExtra.id})` : info.guild) +
    '\r\n' +
    'Channel:\t' +
    (info.channelExtra ? `${info.channelExtra.name} (${info.channelExtra.id})` : info.channel) +
    '\r\n' +
    'Requester:\t' +
    (info.requesterExtra ? `${info.requesterExtra.username}#${info.requesterExtra.discriminator} (${info.requesterId})` : info.requester) +
    '\r\n' +
    'Start time:\t' +
    info.startTime +
    '\r\n' +
    '\r\n' +
    'Tracks:\r\n';

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    txt += `\t${user.username}#${user.discriminator} (${user.id})\r\n`;
  }

  if (notes && notes.length) {
    txt += '\r\nNotes:\r\n';
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      txt += `\t${convertToTimeMark(parseFloat(note.time), true)}: ${note.note}\r\n`;
    }
  }

  return txt;
}
