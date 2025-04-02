import fs from 'node:fs/promises';

import type { RecordingInfo, RecordingNote, RecordingUser } from '@craig/types/recording';

import { convertToTimeMark } from './index.js';

export async function getRecordingInfo(recFileBase: string) {
  const [info, users] = await Promise.all([
    (async () => {
      const data = await fs.readFile(`${recFileBase}.info`, { encoding: 'utf8' });
      return JSON.parse(data) as RecordingInfo;
    })(),
    getRecordingUsers(recFileBase)
  ]);

  return { info, users };
}

export async function getRecordingUsers(recFileBase: string) {
  const data = await fs.readFile(`${recFileBase}.users`, { encoding: 'utf8' });
  const userRecord = JSON.parse(`{${data}}`) as Record<number, RecordingUser>;
  return Object.entries(userRecord)
    .map(([i, user]) => ({ ...user, track: parseInt(i) }))
    .filter((u) => u.track !== 0);
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
