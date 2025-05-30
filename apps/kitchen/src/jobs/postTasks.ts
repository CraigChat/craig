import { prisma } from '@craig/db';
import { rename, unlink } from 'fs/promises';
import { basename, join } from 'path';

import { DOWNLOADS_DIRECTORY } from '../util/config.js';
import { pathExists } from '../util/index.js';
import logger from '../util/logger.js';
import { getRecordingInfo } from '../util/recording.js';
import type { Job } from './job.js';
import { dropboxUpload } from './upload/dropbox.js';
import { googleUpload } from './upload/google.js';
import { onedriveUpload } from './upload/onedrive.js';

export const postTasks: { [name: string]: (job: Job) => Promise<void> } = {
  download: moveToDownloads,
  upload: cloudUpload
};

async function moveToDownloads(job: Job) {
  const downloadPath = join(DOWNLOADS_DIRECTORY, basename(job.outputFile));
  if (await pathExists(downloadPath)) await unlink(downloadPath);
  await rename(job.outputFile, downloadPath);
}

async function cloudUpload(job: Job) {
  job.setState({ type: 'uploading' });
  let driveService = '<unknown>';
  try {
    const recordingInfo = await getRecordingInfo(job.recFileBase).catch(() => null);
    if (!recordingInfo) return;
    const { info } = recordingInfo;
    const startDate = new Date(info.startTime);
    const fileName = [
      'craig',
      job.recordingId,
      `${startDate.getFullYear()}-${startDate.getMonth() + 1}-${startDate.getDate()}`,
      `${startDate.getHours()}-${startDate.getMinutes()}-${startDate.getSeconds()}`
    ].join('_');

    if (!job.postTaskOptions?.userId) return;
    const user = await prisma.user.findFirst({ where: { id: job.postTaskOptions.userId } });
    if (!user) return;
    driveService = user.driveService;
    if (user.rewardTier === 0 || !user.driveEnabled) return;
    job.outputData.uploadService = user.driveService;

    logger.info(`Uploading ${job.recordingId} to ${user.id} via ${user.driveService} (${job.options?.format}/${job.options?.container})`);

    switch (user.driveService) {
      case 'google': {
        await googleUpload(job, info, fileName);
        break;
      }
      case 'onedrive': {
        await onedriveUpload(job, info, fileName);
        break;
      }
      case 'dropbox': {
        await dropboxUpload(job, info, fileName);
        break;
      }
    }

    logger.info(`Uploaded ${job.recordingId} to ${user.id} via ${user.driveService}`);
  } catch (e) {
    job.outputData.uploadError = true;
    logger.error(`Failed to upload ${job.recordingId} for ${job.postTaskOptions?.userId} via ${driveService}`, e);

    throw e;
  } finally {
    if (!job.outputData.uploadError) job.cleanup(true);
  }
}
