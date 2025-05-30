import { open, stat } from 'node:fs/promises';

import { prisma } from '@craig/db';
import { RecordingInfo } from '@craig/types/recording';

import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_REDIRECT, MICROSOFT_CLIENT_SECRET } from '../../util/config.js';
import { getRecordingDescription, UploadError } from '../../util/index.js';
import logger from '../../util/logger.js';
import { Job } from '../job.js';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

async function getRefreshedMicrosoftAccessToken(accessToken: string, refreshToken: string, userId: string) {
  const user = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (user.status === 200) return accessToken;

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: MICROSOFT_CLIENT_ID!,
      client_secret: MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
      redirect_uri: MICROSOFT_CLIENT_REDIRECT!
    }).toString()
  });

  if (response.status === 200) {
    const { access_token, refresh_token } = await response.json();
    await prisma.microsoftUser.update({ where: { id: userId }, data: { token: access_token, refreshToken: refresh_token } });
    return access_token;
  }

  return null;
}

export async function onedrivePreflight(userId: string) {
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_CLIENT_REDIRECT) return false;
  const driveUser = await prisma.microsoftUser.findFirst({ where: { id: userId } });
  if (!driveUser) return false;
  const accessToken = await getRefreshedMicrosoftAccessToken(driveUser.token, driveUser.refreshToken, userId);
  if (!accessToken) {
    await prisma.microsoftUser.delete({ where: { id: userId } });
    return false;
  }

  return true;
}

async function chunkUpload(job: Job, uploadUrl: string) {
  const fileSize = (await stat(job.outputFile)).size;
  const fd = await open(job.outputFile, 'r');
  let start = 0;

  while (start < fileSize) {
    const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
    const length = end - start + 1;

    const buffer = Buffer.alloc(length);
    await fd.read(buffer, 0, length, start);

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': length.toString(),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`
      },
      body: buffer,
      signal: job.abortController.signal
    });

    // 202 = more chunks needed, 200/201 = completed
    if (res.status === 200 || res.status === 201) {
      console.log('Upload complete!');
      const result = await res.json();
      await fd.close();
      return result;
    } else if (res.status !== 202) {
      const data = await res.json().catch(() => null);
      await fd.close();
      throw new UploadError(`OneDrive Error (${res.status}): ${data?.error?.message || 'UnexpectedError'}`);
    }

    start += CHUNK_SIZE;
  }

  await fd.close();
}

export async function onedriveUpload(job: Job, info: RecordingInfo, fileName: string) {
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_CLIENT_REDIRECT) return;

  const userId = job.postTaskOptions!.userId!;
  const driveUser = await prisma.microsoftUser.findFirst({ where: { id: userId } });
  if (!driveUser) return;
  const accessToken = driveUser.token;

  const uploadSession = await fetch(
    `https://graph.microsoft.com/v1.0/drive/special/approot:/${fileName}.${job.getExtension()}:/createUploadSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'rename',
          name: `${fileName}.${job.getExtension()}`
        },
        deferCommit: true
      }),
      signal: job.abortController.signal
    }
  );

  if (uploadSession.status !== 200) {
    logger.error(
      `OneDrive error while creating upload session for recording ${job.recordingId} for user ${userId} (${uploadSession.status})`,
      await uploadSession.text().catch(() => null)
    );
    throw new UploadError('Your Microsoft authentication has either expired or I was not allowed to upload, please re-authenticate.');
  }

  const uploadUrl = (await uploadSession.json()).uploadUrl as string;
  const file = await chunkUpload(job, uploadUrl);

  // Since I can't just set the description in the upload session, here's an update to set it instead.
  await fetch(`https://graph.microsoft.com/v1.0/drive/items/${file.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      description: getRecordingDescription(job.recordingId, info, ' - ')
    }),
    signal: job.abortController.signal
  }).catch(() => {});

  // // Set file icon
  // if (info.guildExtra.icon) {
  //   const icon = await axios.get(info.guildExtra.icon, { responseType: 'arraybuffer' });
  //   await axios.put(`https://graph.microsoft.com/v1.0/drive/items/${file.data.id}/thumbnails/0/source/content`, icon.data, {
  //     headers: { 'Content-Type': icon.headers['content-type'], Authorization: `Bearer ${accessToken}` }
  //   });
  // }

  job.outputData.uploadFileId = file.id;
  job.outputData.uploadFileURL = file.webUrl;
}
