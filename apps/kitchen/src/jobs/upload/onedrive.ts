import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { prisma } from '@craig/db';
import { RecordingInfo } from '@craig/types/recording';

import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_REDIRECT, MICROSOFT_CLIENT_SECRET } from '../../util/config.js';
import { getRecordingDescription, UploadError } from '../../util/index.js';
import logger from '../../util/logger.js';
import { Job } from '../job.js';

const CHUNKS_PER_DRIVE_UPLOAD = 20;

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
        '@microsoft.graph.conflictBehavior': 'rename',
        name: `${fileName}.${job.getExtension()}`,
        item: {
          description: getRecordingDescription(job.recordingId, info, ' - ')
        }
      })
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

  const fileSize = (await stat(job.outputFile)).size;
  const readStream = createReadStream(job.outputFile);

  const file: any = await new Promise((resolve, reject) => {
    let uploadedBytes = 0;
    let chunksToUploadSize = 0;
    let chunks: Buffer[] = [];

    readStream.on('data', async (chunk) => {
      chunks.push(chunk as Buffer);
      chunksToUploadSize += chunk.length;

      // upload only if we've specified number of chunks in memory OR we're uploading the final chunk
      if (chunks.length === CHUNKS_PER_DRIVE_UPLOAD || chunksToUploadSize + uploadedBytes === fileSize) {
        readStream.pause();

        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunksToUploadSize),
            'Content-Range': 'bytes ' + uploadedBytes + '-' + (uploadedBytes + chunksToUploadSize - 1) + '/' + fileSize
          },
          body: Buffer.concat(chunks, chunksToUploadSize)
        });

        if (response.status >= 400) {
          readStream.close();
          const data = await response.json().catch(() => null);
          return reject(new UploadError(`OneDrive Error (${response.status}): ${data?.error?.message || 'UnexpectedError'}`));
        }

        // update uploaded bytes
        uploadedBytes += chunksToUploadSize;

        // reset for next chunks
        chunks = [];
        chunksToUploadSize = 0;

        if (response.status === 201 || response.status === 203 || response.status === 200) return resolve(await response.json());

        readStream.resume();
      }
    });
  });

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
