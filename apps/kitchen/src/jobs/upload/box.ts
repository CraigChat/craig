import { open, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { prisma } from '@craig/db';
import { RecordingInfo } from '@craig/types/recording';

import { BOX_CLIENT_ID, BOX_CLIENT_SECRET } from '../../util/config.js';
import { getRecordingDescription, UploadError, wait } from '../../util/index.js';
import logger from '../../util/logger.js';
import { Job } from '../job.js';

const MIN_SIZE_FOR_CHUNKED_UPLOAD = 50 * 1024 * 1024; // 50MB

function formatTimestamp(date: Date): string {
  const offsetMinutes = date.getTimezoneOffset();
  const offsetSign = offsetMinutes > 0 ? '-' : '+';
  const offsetHoursAbs = Math.abs(Math.floor(offsetMinutes / 60));
  const offsetMinutesAbs = Math.abs(offsetMinutes % 60);
  const tzStr = offsetSign + ('0' + offsetHoursAbs).slice(-2) + ':' + ('0' + offsetMinutesAbs).slice(-2);

  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const hours = ('0' + date.getHours()).slice(-2);
  const minutes = ('0' + date.getMinutes()).slice(-2);
  const seconds = ('0' + date.getSeconds()).slice(-2);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzStr}`;
}

interface BoxUploadSession {
  id: string;
  type: 'upload_session',
  num_parts_processed: number;
  part_size: number;
  session_endpoints: {
    abort: string;
    commit: string;
    list_parts: string;
    log_event: string;
    status: string;
    upload_part: string;
  },
  session_expires_at: string;
  total_parts: number;
}

interface BoxPreflightResponse {
  upload_token: string;
  upload_url: string;
}

async function getRefreshedBoxAccessToken(accessToken: string, refreshToken: string, userId: string) {
  const user = await fetch('https://api.box.com/2.0/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (user.status === 200) return accessToken;

  const response = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: BOX_CLIENT_ID!,
      client_secret: BOX_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  if (response.status === 200) {
    const { access_token, refresh_token } = await response.json();
    await prisma.boxUser.update({ where: { id: userId }, data: { token: access_token, refreshToken: refresh_token } });
    return access_token;
  }

  return null;
}

async function findCraigDirectory(accessToken: string, userId: string) {
  try {
    // Search for the folder
    const searchResponse = await fetch(`https://api.box.com/2.0/search?${new URLSearchParams({
        type: 'folder',
        query: 'Craig',
        limit: '1'
      }).toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (searchResponse.status !== 200) {
      const data = await searchResponse.json().catch(() => null);
      throw new UploadError(`Box Error (${searchResponse.status}): ${data?.code || 'UnexpectedError'}`);
    }

    const searchResults = await searchResponse.json();
    if (searchResults.entries.length > 0) return searchResults.entries[0].id;

    // Sometimes the index isnt updated yet, so just search the root folder
    const folderResponse = await fetch(`https://api.box.com/2.0/folders/0/items?${new URLSearchParams({
        fields: 'id,type,name'
      }).toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (folderResponse.status !== 200) {
      const data = await folderResponse.json().catch(() => null);
      throw new UploadError(`Box Error (${searchResponse.status}): ${data?.code || 'UnexpectedError'}`);
    }

    const folderContents = await folderResponse.json();
    const craigfolder = folderContents.entries.find((e: any) => e.type === 'folder' && e.name === 'Craig');
    if (craigfolder) return craigfolder.id;

    // Create the folder if none exist
    const response = await fetch('https://api.box.com/2.0/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
       name: 'Craig',
       parent: { id: '0' }
      })
    });

    if (response.status !== 200) {
      const data = await response.json().catch(() => null);
      throw new UploadError(`Box Error (${response.status}): ${data?.code || 'UnexpectedError'}`);
    }

    return (await response.json()).id;
  } catch (e) {
    logger.warn(`Failed to get Craig directory for user ${userId}`, e);
    return null;
  }
}

export async function boxPreflight(userId: string) {
  if (!BOX_CLIENT_ID || !BOX_CLIENT_SECRET) return false;
  const driveUser = await prisma.boxUser.findFirst({ where: { id: userId } });
  if (!driveUser) return false;
  const accessToken = await getRefreshedBoxAccessToken(driveUser.token, driveUser.refreshToken, userId);
  if (!accessToken) {
    await prisma.boxUser.delete({ where: { id: userId } });
    return false;
  }

  const folderId = await findCraigDirectory(accessToken, userId);
  if (!folderId) return false;
  return { folderId };
}

async function chunkUpload(job: Job, session: BoxUploadSession, accessToken: string, info: RecordingInfo) {
  const fileSize = (await stat(job.outputFile)).size;
  const fd = await open(job.outputFile, 'r');
  let start = 0;
  const parts = [];
  const fullHash = createHash('sha1');

  while (start < fileSize || parts.length < session.total_parts) {
    const end = Math.min(start + session.part_size - 1, fileSize - 1);
    const length = end - start + 1;

    const buffer = Buffer.alloc(length);
    await fd.read(buffer, 0, length, start);
    fullHash.update(buffer);

    const partDigest = createHash('sha1').update(buffer).digest('base64');

    const res = await fetch(session.session_endpoints.upload_part, {
      method: 'PUT',
      headers: {
        'Content-Length': length.toString(),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Digest': `sha=${partDigest}`
      },
      body: buffer,
      signal: job.abortController.signal
    });

    if (res.status === 200) {
      const { part } = await res.json();
      parts.push(part);
    } else {
      const data = await res.json().catch(() => null);
      await fd.close();
      throw new UploadError(`Box Error (${res.status}): ${data?.code || 'UnexpectedError'}`);
    }

    start += length;
  }

  await fd.close();
  const fullDigest = fullHash.digest('base64');

  let commitResponse;
  do {
    commitResponse = await fetch(
      session.session_endpoints.commit,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Digest': `sha=${fullDigest}`
        },
        body: JSON.stringify({
          parts,
          attributes: {
            content_created_at: formatTimestamp(new Date(info.startTime)),
          }
        }),
        signal: job.abortController.signal
      }
    );

    if (commitResponse.status === 202) {
      const retryAfter = parseInt(commitResponse.headers.get('retry-after') || '5');
      await wait(retryAfter * 1000);
    } else if (commitResponse.status === 201) {
      break;
    } else {
      const data = await commitResponse.json().catch(() => null);
      throw new UploadError(`Box Error (${commitResponse.status}): ${data?.code || 'UnexpectedError'}`);
    }
  } while (true);

  const data = await commitResponse.json();
  return data.entries[0];
}

export async function boxUpload(job: Job, info: RecordingInfo, fileName: string) {
  if (!BOX_CLIENT_ID || !BOX_CLIENT_SECRET) return;

  const userId = job.postTaskOptions!.userId!;
  const driveUser = await prisma.boxUser.findFirst({ where: { id: userId } });
  if (!driveUser) return;
  const accessToken = await getRefreshedBoxAccessToken(driveUser.token, driveUser.refreshToken, userId);
  if (!accessToken) {
    await prisma.boxUser.delete({ where: { id: userId } });
    throw new UploadError('Box authentication failed, please re-authenticate.');
  }

  const folderId = job.postTaskOptions?.uploadFolderId || (await findCraigDirectory(accessToken, userId));
  if (!folderId) throw new UploadError('Your Box authentication was invalidated, please re-authenticate.');
  const fileSize = (await stat(job.outputFile)).size;

  console.log(`uploading file ${fileName} - ${fileSize}`)
  if (fileSize < MIN_SIZE_FOR_CHUNKED_UPLOAD) {
    const buffer = await readFile(job.outputFile);

    const preflightResponse = await fetch('https://api.box.com/2.0/files/content', {
      method: 'OPTIONS',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${fileName}.${job.getExtension()}`,
        size: fileSize,
        parent: { id: folderId }
      }),
      signal: job.abortController.signal
    });

    if (preflightResponse.status === 409)
      throw new UploadError('The recording could not be uploaded to Box possibly due to exceeding a storage limit on the account.');
    else if (preflightResponse.status !== 200) {
      const data = await preflightResponse.json().catch(() => null);
      throw new UploadError(`Box Error (${preflightResponse.status}): ${data?.code || 'UnexpectedError'}`);
    }

    const { upload_url } = await preflightResponse.json();

    const formData = new FormData();
    formData.append('attributes', JSON.stringify({
      name: `${fileName}.${job.getExtension()}`,
      content_created_at: formatTimestamp(new Date(info.startTime)),
      parent: { id: folderId }
    }));
    formData.append('file', new Blob([new Uint8Array(buffer)]));

    const uploadResponse = await fetch(upload_url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData,
      signal: job.abortController.signal
    });

    if (uploadResponse.status === 201) {
      const data = await uploadResponse.json();
      const file = data.entries[0];
      job.outputData.uploadFileId = file.id;
      job.outputData.uploadFileURL = `https://app.box.com/file/${file.id}`;
    } else {
      const data = await uploadResponse.json().catch(() => null);
      console.log({ data })
      throw new UploadError(`Box Error (${uploadResponse.status}): ${data?.code || 'UnexpectedError'}`);
    }
  } else {
    const uploadSession = await fetch(
      'https://upload.box.com/api/2.0/files/upload_sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          file_name: `${fileName}.${job.getExtension()}`,
          file_size: fileSize,
          folder_id: folderId
        }),
        signal: job.abortController.signal
      }
    );

    if (uploadSession.status === 409 || uploadSession.status === 403) {
      logger.error(
        `Box error while creating upload session for recording ${job.recordingId} for user ${userId} (${uploadSession.status})`,
        await uploadSession.text().catch(() => null)
      );
      throw new UploadError('The recording could not be uploaded to Box due to exceeding a storage/file size limit on the account.');
    } else if (uploadSession.status !== 200) {
      logger.error(
        `Box error while creating upload session for recording ${job.recordingId} for user ${userId} (${uploadSession.status})`,
        await uploadSession.text().catch(() => null)
      );
      throw new UploadError('An error occurred while uploading this recording to your Box account.');
    }

    const sessionResult: BoxUploadSession = await uploadSession.json();
    const file = await chunkUpload(job, sessionResult, accessToken, info);

    job.outputData.uploadFileId = file.id;
    job.outputData.uploadFileURL = `https://app.box.com/file/${file.id}`;
  }
}
