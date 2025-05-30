import { createReadStream } from 'node:fs';

import { prisma } from '@craig/db';
import { RecordingInfo } from '@craig/types/recording';
import { type drive_v3, google } from 'googleapis';

import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../../util/config.js';
import { getRecordingDescription, UploadError } from '../../util/index.js';
import logger from '../../util/logger.js';
import { Job } from '../job.js';

async function findCraigDirectoryInGoogleDrive(drive: drive_v3.Drive, userId: string) {
  try {
    const list = await drive.files.list({
      q: "name = 'Craig' and mimeType = 'application/vnd.google-apps.folder'"
    });

    if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;

    const folder = await drive.files.create({
      requestBody: {
        name: 'Craig',
        mimeType: 'application/vnd.google-apps.folder',
        folderColorRgb: '#00aaaa'
      }
    });

    return folder.data.id;
  } catch (e) {
    logger.warn(`Failed to get Craig directory for user ${userId}`, e);
    return null;
  }
}

export async function googlePreflight(userId: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return false;

  const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  const driveUser = await prisma.googleDriveUser.findFirst({ where: { id: userId } });
  if (!driveUser) return;
  oAuth2Client.setCredentials({
    access_token: driveUser.token,
    refresh_token: driveUser.refreshToken
  });

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  oAuth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token)
      await prisma.googleDriveUser.update({
        where: { id: userId },
        data: {
          refreshToken: tokens.refresh_token
        }
      });
  });

  const folderId = await findCraigDirectoryInGoogleDrive(drive, userId);
  if (!folderId) return false;
  return { folderId };
}

export async function googleUpload(job: Job, info: RecordingInfo, fileName: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return;
  const userId = job.postTaskOptions!.userId!;
  const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  const driveUser = await prisma.googleDriveUser.findFirst({ where: { id: userId } });
  if (!driveUser) return;
  oAuth2Client.setCredentials({
    access_token: driveUser.token,
    refresh_token: driveUser.refreshToken
  });

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  oAuth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token)
      await prisma.googleDriveUser.update({
        where: { id: userId },
        data: {
          refreshToken: tokens.refresh_token
        }
      });
  });

  const folderId = job.postTaskOptions?.googleFolderId || (await findCraigDirectoryInGoogleDrive(drive, userId));
  if (!folderId) throw new UploadError('Your Google authentication was invalidated, please re-authenticate.');
  const mimeType = job.getMimeType();

  const file = await drive.files.create({
    quotaUser: userId,
    requestBody: {
      name: `${fileName}.${job.getExtension()}`,
      mimeType,
      parents: [folderId],
      createdTime: info.startTime,
      description: getRecordingDescription(job.recordingId, info),
      properties: {
        'craig-recording-id': job.recordingId,
        'craig-requester-id': info.requesterId,
        'craig-guild-id': info.guildExtra.id,
        'craig-channel-id': info.channelExtra.id
      },
      contentHints: {
        indexableText: `${info.channel} - ${info.guild} - Craig recording ${job.recordingId} - https://craig.chat/`
      }
    },
    media: {
      mimeType,
      body: createReadStream(job.outputFile)
    }
  });

  job.outputData.uploadFileId = file.data.id!;
  job.outputData.uploadFileURL = `https://drive.google.com/open?id=${file.data.id}`;
}
