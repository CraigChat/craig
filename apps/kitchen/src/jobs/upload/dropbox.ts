import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { prisma } from '@craig/db';
import { RecordingInfo } from '@craig/types/recording';
import { Dropbox, DropboxAuth, DropboxResponse, DropboxResponseError, files } from 'dropbox';

import { DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET, DROPBOX_FOLDER_NAME } from '../../util/config.js';
import logger from '../../util/logger.js';
import { Job } from '../job.js';

const CHUNKS_PER_DRIVE_UPLOAD = 20;
const DROPBOX_UPLOAD_FILE_SIZE_LIMIT = 150 * 1024 * 1024;

export async function dropboxPreflight(userId: string) {
  if (!DROPBOX_CLIENT_ID || !DROPBOX_CLIENT_SECRET || !DROPBOX_FOLDER_NAME) return false;

  const driveUser = await prisma.dropboxUser.findFirst({ where: { id: userId } });
  if (!driveUser) return false;

  const auth = new DropboxAuth({
    clientId: DROPBOX_CLIENT_ID,
    clientSecret: DROPBOX_CLIENT_SECRET,
    accessToken: driveUser.token,
    refreshToken: driveUser.refreshToken
  });

  const dbx = new Dropbox({ auth });

  try {
    await dbx.usersGetCurrentAccount();
  } catch (e) {
    logger.warn(`Error in dropbox preflight for user ${userId}`, e);
    if (e instanceof DropboxResponseError && (e.status === 401 || e.status === 403))
      await prisma.dropboxUser.delete({ where: { id: userId } });
    return false;
  }

  // Persist any tokens refreshed by the SDK during the API call
  const accessToken = auth.getAccessToken();
  const refreshToken = auth.getRefreshToken();
  if (accessToken !== driveUser.token || refreshToken !== driveUser.refreshToken)
    await prisma.dropboxUser.update({ where: { id: userId }, data: { refreshToken, token: accessToken } });

  return true;
}

export async function dropboxUpload(job: Job, info: RecordingInfo, fileName: string) {
  if (!DROPBOX_CLIENT_ID || !DROPBOX_CLIENT_SECRET || !DROPBOX_FOLDER_NAME) return;

  const userId = job.postTaskOptions!.userId!;
  const driveUser = await prisma.dropboxUser.findFirst({ where: { id: userId } });
  if (!driveUser) return;

  const auth = new DropboxAuth({
    clientId: DROPBOX_CLIENT_ID,
    clientSecret: DROPBOX_CLIENT_SECRET,
    accessToken: driveUser.token,
    refreshToken: driveUser.refreshToken
  });

  const dbx = new Dropbox({ auth });

  const ext = job.getExtension();
  const fileSize = (await stat(job.outputFile)).size;
  const readStream = createReadStream(job.outputFile);
  const file: DropboxResponse<files.FileMetadata> =
    fileSize < DROPBOX_UPLOAD_FILE_SIZE_LIMIT
      ? await dbx.filesUpload({ path: `/${fileName}.${ext}`, autorename: true, contents: readStream })
      : await new Promise((resolve, reject) => {
          let sessionId = '';
          let uploadedBytes = 0;
          let chunksToUploadSize = 0;
          let chunks: Buffer[] = [];
          let processing = false;

          readStream.on('error', (err) => {
            reject(err);
          });

          async function processChunks(finished: boolean) {
            if (processing) return;
            processing = true;
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
              logger.error(`Error in dropbox upload for recording ${job.recordingId} for user ${userId}`, e);
              return reject(e);
            }

            uploadedBytes += chunksToUploadSize;
            chunks = [];
            chunksToUploadSize = 0;
            processing = false;

            readStream.resume();
          }

          readStream.on('data', (chunk) => {
            chunks.push(chunk as Buffer);
            chunksToUploadSize += chunk.length;

            const finished = chunksToUploadSize + uploadedBytes === fileSize;

            if (chunks.length === CHUNKS_PER_DRIVE_UPLOAD || finished) {
              processChunks(finished);
            }
          });

          readStream.on('end', () => {
            if (chunks.length > 0) {
              processChunks(true);
            }
          });
        });

  const accessToken = auth.getAccessToken();
  const refreshToken = auth.getRefreshToken();
  if (accessToken !== driveUser.token || refreshToken !== driveUser.refreshToken)
    await prisma.dropboxUser.update({
      where: { id: userId },
      data: { refreshToken, token: accessToken }
    });

  job.outputData.uploadFileId = file.result.id;
  job.outputData.uploadFileURL = `https://www.dropbox.com/home/Apps/${encodeURIComponent(DROPBOX_FOLDER_NAME)}?preview=${encodeURIComponent(
    file.result.name
  )}`;
}
