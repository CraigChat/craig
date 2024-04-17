import axios, { type AxiosError } from 'axios';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import config from 'config';
import { Dropbox, DropboxAuth, DropboxResponse, Error as DropboxError, files } from 'dropbox';
import { drive_v3, google } from 'googleapis';
import type { ClientRequest } from 'http';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLogger } from '../logger';
import { prisma } from '../prisma';
import { clearReadyState, setReadyState } from '../redis';

const CHUNKS_PER_DRIVE_UPLOAD = 20;

const driveConfig = config.get<{
  clientId: string;
  clientSecret: string;
}>('drive');

const microsoftConfig = config.get<{
  clientId: string;
  clientSecret: string;
  redirect: string;
}>('microsoft');

const dropboxConfig = config.get<{
  clientId: string;
  clientSecret: string;
  folderName: string;
}>('dropbox');

const logger = createLogger('drive');

const recPath = config.has('recording.path')
  ? path.join(__dirname, '..', '..', config.get<string>('recording.path'))
  : path.join(__dirname, '..', '..', '..', '..', 'rec');
const cookPath = config.has('cookPath')
  ? path.join(__dirname, '..', '..', config.get<string>('cookPath'))
  : path.join(__dirname, '..', '..', '..', '..', 'cook');

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    return false;
  }
}

function killProcessTree(p: ChildProcessWithoutNullStreams) {
  if (p.killed || !p.pid) return true;
  try {
    const result = process.kill(p.pid);
    return result;
  } catch (e) {
    if ((e as Error).message.startsWith('kill ESRCH')) return true;
    return false;
  }
}

async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  if (!/^[a-zA-Z0-9]+$/.test(id) || !/^[a-z38]+$/.test(format) || !/^[a-z]+$/.test(container)) throw new Error('An invalid argument was passed.');

  try {
    await setReadyState(id, { message: 'Uploading recording to cloud backup...' });
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const child = spawn(cookingPath, args, { detached: true });
    logger.log(`Cooking ${id} (${format}.${container}${dynaudnorm ? ' dynaudnorm' : ''}) with process ${child.pid}`);

    // Prevent the stream from ending prematurely (for some reason)
    child.stderr.on('data', () => {});

    return child;
  } catch (e) {
    await clearReadyState(id);
    throw e;
  }
}

async function findCraigDirectoryInGoogleDrive(drive: drive_v3.Drive) {
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
    return null;
  }
}

async function getRefreshedMicrosoftAccessToken(accessToken: string, refreshToken: string, userId: string) {
  const me = await axios.get('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    validateStatus: () => true
  });

  if (me.status === 200) return accessToken;

  const response = await axios.post(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: microsoftConfig.clientId,
      client_secret: microsoftConfig.clientSecret,
      refresh_token: refreshToken,
      redirect_uri: microsoftConfig.redirect
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    }
  );

  if (response.status === 200) {
    const { access_token, refresh_token } = response.data;
    await prisma.microsoftUser.update({ where: { id: userId }, data: { token: access_token, refreshToken: refresh_token } });
    return access_token;
  }

  return null;
}

function getRecordingDescription(recordingId: string, info: any, joiner = '\n') {
  return [
    `Craig recording ${recordingId} via https://craig.chat/`,
    '',
    `${info.autorecorded ? 'Auto-recorded in behalf of' : 'Started by'}: ${info.requester} (${info.requesterId})`,
    `Server: ${info.guild} (${info.guildExtra.id})`,
    `Channel: ${info.channel} (${info.channelExtra.id})`
  ].join(joiner);
}

const FormatToMime: Record<string, string> = {
  flac: 'audio/flac',
  vorbis: 'audio/ogg',
  aac: 'audio/aac'
};

const FormatToExt: Record<string, string> = {
  flac: 'flac',
  vorbis: 'ogg',
  aac: 'aac'
};

export async function driveUpload({
  recordingId,
  userId
}: {
  recordingId: string;
  userId: string;
}): Promise<{ error: null | string; notify: boolean; id?: string; url?: string }> {
  const infoExists = await fileExists(path.join(recPath, `${recordingId}.ogg.info`));
  if (!infoExists) return { error: 'info_deleted', notify: false };
  const dataExists = await fileExists(path.join(recPath, `${recordingId}.ogg.data`));
  if (!dataExists) return { error: 'data_deleted', notify: false };
  const info = JSON.parse(await fs.readFile(path.join(recPath, `${recordingId}.ogg.info`), 'utf8'));
  const startDate = new Date(info.startTime);
  const fileName = `craig_${recordingId}_${startDate.getFullYear()}-${
    startDate.getMonth() + 1
  }-${startDate.getDate()}_${startDate.getHours()}-${startDate.getMinutes()}-${startDate.getSeconds()}`;

  const user = await prisma.user.findFirst({ where: { id: userId } });
  if (!user) return { error: 'user_not_found', notify: false };
  if (user.rewardTier === 0) return { error: 'user_not_allowed', notify: false };
  if (!user.driveEnabled) return { error: 'not_enabled', notify: false };
  if (user.rewardTier !== -1 && user.rewardTier < 20 && user.driveContainer === 'mix')
    return { error: 'mix_unavailable_with_current_tier', notify: false };

  const format = user.driveFormat || 'flac';
  const container = user.driveContainer || 'zip';
  logger.info(`Uploading ${recordingId} to ${userId} via ${user.driveService} (${format}.${container})`);

  let child: ChildProcessWithoutNullStreams | null = null;
  let tempFile: string | null = null;
  let uploadUrl: string | null = null;

  const mime =
    container === 'mix'
      ? FormatToMime[format] || 'audio/flac'
      : container === 'exe'
      ? 'application/vnd.microsoft.portable-executable'
      : 'application/zip';
  const ext = container === 'mix' ? FormatToExt[format] || 'flac' : container === 'exe' ? 'exe' : 'zip';

  try {
    switch (user.driveService) {
      case 'google': {
        const oAuth2Client = new google.auth.OAuth2(driveConfig.clientId, driveConfig.clientSecret);
        const driveUser = await prisma.googleDriveUser.findFirst({ where: { id: userId } });
        if (!driveUser) return { error: 'data_not_found', notify: false };
        oAuth2Client.setCredentials({
          access_token: driveUser.token,
          refresh_token: driveUser.refreshToken
        });
        const drive = google.drive({ version: 'v3', auth: oAuth2Client });

        // Update refresh token
        oAuth2Client.on('tokens', async (tokens) => {
          if (tokens.refresh_token)
            await prisma.googleDriveUser.update({
              where: { id: userId },
              data: { refreshToken: tokens.refresh_token }
            });
        });

        const folderId = await findCraigDirectoryInGoogleDrive(drive);
        if (!folderId) return { error: 'google_token_expired', notify: true };
        child = await cook(recordingId, format, container);

        tempFile = path.join(tmpdir(), `${fileName}-${(Math.random() * 1000000).toString(36)}-upload.tmp`);
        await fs.writeFile(tempFile, child.stdout);

        await clearReadyState(recordingId);
        killProcessTree(child);

        // TODO server icon as contentHints.thumbnail ?

        const file = await drive.files.create({
          quotaUser: userId,
          requestBody: {
            name: `${fileName}.${ext}`,
            mimeType: mime,
            parents: [folderId],
            createdTime: info.startTime,
            description: getRecordingDescription(recordingId, info),
            properties: {
              'craig-recording-id': recordingId,
              'craig-requester-id': info.requesterId,
              'craig-guild-id': info.guildExtra.id,
              'craig-channel-id': info.channelExtra.id
            },
            contentHints: {
              indexableText: `${info.channel} - ${info.guild} - Craig recording ${recordingId} - https://craig.chat/`
            }
          },
          media: {
            mimeType: mime,
            body: createReadStream(tempFile)
          }
        });

        await fs.unlink(tempFile).catch(() => {});

        return {
          error: null,
          notify: true,
          id: file.data.id!,
          url: `https://drive.google.com/open?id=${file.data.id}`
        };
      }
      case 'onedrive': {
        const driveUser = await prisma.microsoftUser.findFirst({ where: { id: userId } });
        if (!driveUser) return { error: 'data_not_found', notify: false };
        const accessToken = await getRefreshedMicrosoftAccessToken(driveUser.token, driveUser.refreshToken, userId);
        if (!accessToken) {
          await prisma.microsoftUser.delete({ where: { id: userId } });
          return { error: 'microsoft_token_expired', notify: true };
        }
        child = await cook(recordingId, format, container);

        tempFile = path.join(tmpdir(), `${fileName}-${(Math.random() * 1000000).toString(36)}-upload.tmp`);
        await fs.writeFile(tempFile, child.stdout);

        await clearReadyState(recordingId);
        killProcessTree(child);

        const uploadSession = await axios.post(
          `https://graph.microsoft.com/v1.0/drive/special/approot:/${fileName}.${ext}:/createUploadSession`,
          JSON.stringify({
            '@microsoft.graph.conflictBehavior': 'rename',
            name: `${fileName}.${ext}`,
            item: {
              description: getRecordingDescription(recordingId, info, ' - ')
            }
          }),
          {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
          }
        );

        uploadUrl = uploadSession.data.uploadUrl as string;

        const fileSize = (await fs.stat(tempFile)).size;
        const readStream = createReadStream(tempFile);

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

              const response = await axios.put(uploadUrl!, Buffer.concat(chunks, chunksToUploadSize), {
                headers: {
                  'Content-Length': String(chunksToUploadSize),
                  'Content-Range': 'bytes ' + uploadedBytes + '-' + (uploadedBytes + chunksToUploadSize - 1) + '/' + fileSize
                },
                validateStatus: () => true
              });

              if (response.status >= 400) {
                readStream.close();
                return reject(new Error(`OneDrive Error (${response.status}): ${response.data?.error?.message || 'UnexpectedError'}`));
              }

              // update uploaded bytes
              uploadedBytes += chunksToUploadSize;

              // reset for next chunks
              chunks = [];
              chunksToUploadSize = 0;

              if (response.status === 201 || response.status === 203 || response.status === 200) return resolve(response.data);

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

        await fs.unlink(tempFile).catch(() => {});

        return {
          error: null,
          notify: true,
          id: file.id,
          url: file.webUrl
        };
      }
      case 'dropbox': {
        const driveUser = await prisma.dropboxUser.findFirst({ where: { id: userId } });
        if (!driveUser) return { error: 'data_not_found', notify: false };
        const DROPBOX_UPLOAD_FILE_SIZE_LIMIT = 150 * 1024 * 1024;

        const auth = new DropboxAuth({
          clientId: dropboxConfig.clientId,
          clientSecret: dropboxConfig.clientSecret,
          accessToken: driveUser.token,
          refreshToken: driveUser.refreshToken
        });

        const dbx = new Dropbox({ auth });

        // Test authorization access before we start uploading
        try {
          await dbx.usersGetCurrentAccount();
        } catch (e) {
          const err: DropboxError<{ error_summary: string }> = e as any;
          logger.error(`Error in uploading recording ${recordingId} for user ${userId} due to dropbox`, err.error);
          await prisma.dropboxUser.delete({ where: { id: userId } });
          return { error: 'dropbox_token_invalid', notify: true };
        }

        child = await cook(recordingId, format, container);

        tempFile = path.join(tmpdir(), `${fileName}-${(Math.random() * 1000000).toString(36)}-upload.tmp`);
        await fs.writeFile(tempFile, child.stdout);

        await clearReadyState(recordingId);
        killProcessTree(child);

        const fileSize = (await fs.stat(tempFile)).size;
        const readStream = createReadStream(tempFile);
        const file: DropboxResponse<files.FileMetadata> = fileSize < DROPBOX_UPLOAD_FILE_SIZE_LIMIT
        ? await dbx.filesUpload({path: `/${fileName}.${ext}`, autorename: true, contents: readStream })
        : await new Promise((resolve, reject) => {
            let sessionId = '';
            let uploadedBytes = 0;
            let chunksToUploadSize = 0;
            let chunks: Buffer[] = [];

            readStream.on('data', async (chunk) => {
              chunks.push(chunk as Buffer);
              chunksToUploadSize += chunk.length;

              const finished = chunksToUploadSize + uploadedBytes === fileSize;

              // upload only if we've specified number of chunks in memory OR we're uploading the final chunk
              if (chunks.length === CHUNKS_PER_DRIVE_UPLOAD || finished) {
                readStream.pause();
                const chunkBuffer = Buffer.concat(chunks, chunksToUploadSize);

                try {
                  if (uploadedBytes === 0) {
                    const response = await dbx.filesUploadSessionStart({ close: false, contents: chunkBuffer });
                    sessionId = response.result.session_id;
                  } else if (finished) {
                    const file = await dbx.filesUploadSessionFinish({
                      cursor: { session_id: sessionId, offset: uploadedBytes },
                      commit: { path: `/${fileName}.${ext}`, autorename: true },
                      contents: chunkBuffer
                    });
                    return resolve(file);
                  } else {
                    await dbx.filesUploadSessionAppendV2({
                      cursor: { session_id: sessionId, offset: uploadedBytes },
                      close: false,
                      contents: chunkBuffer
                    });
                  }
                } catch (e) {
                  return reject(e);
                }

                // update uploaded bytes
                uploadedBytes += chunksToUploadSize;

                // reset for next chunks
                chunks = [];
                chunksToUploadSize = 0;

                readStream.resume();
              }
            });
          });

        await fs.unlink(tempFile).catch(() => {});

        const accessToken = auth.getAccessToken();
        if (accessToken !== driveUser.token)
          await prisma.dropboxUser.update({
            where: { id: userId },
            data: { token: accessToken }
          });

        return {
          error: null,
          notify: true,
          id: file.result.id,
          url: `https://www.dropbox.com/home/Apps/${encodeURIComponent(dropboxConfig.folderName)}?preview=${encodeURIComponent(file.result.name)}`
        };
      }
      default:
        return { error: 'unknown_service', notify: false };
    }
  } catch (e) {
    logger.error(`Error in uploading recording ${recordingId} for user ${userId}`);
    await clearReadyState(recordingId);
    if (child) killProcessTree(child);
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
    if ((e as AxiosError).isAxiosError === true) {
      const response = (e as AxiosError).response;
      const request: ClientRequest = (e as AxiosError).request;
      if (response)
        logger.error(
          `AxiosError (${response.status}) ${request ? `${request.method} ${request.host}${request.path}` : '<unknown request>'}`,
          response.data
        );
      else if (request) logger.error(`AxiosError <unknown response> ${request.method} ${request.host}${request.path}`);
      else console.error(e);
    } else if ((e as Error).name === 'DropboxResponseError') {
      const err: DropboxError<{ error_summary: string }> = e as any;
      logger.error(`DropboxError [${err.error.error_summary}]`, err.error);
      return { error: `DropboxError [${err.error.error_summary}]`, notify: true };
    }
    return { error: (e as any).toString() || 'unknown_error', notify: true };
  }
}
