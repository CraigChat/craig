import fs, { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

import type { CreateJobOptions, JobJSON, SavedJobsJSON } from '@craig/types/kitchen';
import { CronJob } from 'cron';

import {
  DOWNLOADS_DIRECTORY,
  JOB_EXPIRATION,
  KITCHEN_CLEAN_FILES,
  KITCHEN_CRON_TIME,
  OUTPUT_DIRECTORY,
  QUEUE_SIZE,
  REC_DIRECTORY,
  SAVE_JOBS,
  TMP_DIRECTORY,
  TMP_EXPIRATION
} from '../util/config.js';
import { pathExists, wait } from '../util/index.js';
import logger from '../util/logger.js';
import { cleanedBytes, cleanedFiles, jobCount } from '../util/metrics.js';
import { testProcessOptions } from '../util/processOptions.js';
import { deleteSavedJobs, readSavedJobs, writeSavedJobs } from '../util/redis.js';
import { Job } from './job.js';

export default class JobManager {
  cron = new CronJob(KITCHEN_CRON_TIME, this.cleanCron.bind(this), null, false);
  jobs = new Map<string, Job>();
  allowNewJobs = false;
  queueInterval?: NodeJS.Timeout;

  createJob(opts: CreateJobOptions, force = false) {
    if (!this.allowNewJobs && !force) throw new Error('NOT_ACCEPTING_NEW_JOBS');
    const job = new Job(opts, this);
    this.jobs.set(job.id, job);
    jobCount.inc({
      job_type: opts.jobType,
      job_export: job.exportString
    });
    return job;
  }

  createSavedJob(jobJson: JobJSON) {
    const job = Job.fromSaved(jobJson, this);
    this.jobs.set(job.id, job);
    return job;
  }

  cancelAllJobs(reason?: string) {
    const jobsCancelled: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        job.cancel(reason);
        jobsCancelled.push(job);
      }
    }
    return jobsCancelled;
  }

  async recordingExists(recordingId: string) {
    const filePath = path.join(REC_DIRECTORY, `${recordingId}.ogg.info`);
    return pathExists(filePath);
  }

  async loadSavedJobs() {
    if (!SAVE_JOBS) return void logger.info('Skipped loading saved jobs.');

    const savedJobs = await readSavedJobs();
    if (!savedJobs) return void logger.info('No saved jobs found to resume.');
    await deleteSavedJobs();
    logger.info(
      `Loading saved jobs (${savedJobs.timestamp}), ${savedJobs.savedIds.length.toString()} saved, ${savedJobs.resumeIds.length.toString()} resumable`
    );

    if (savedJobs.resumeIds.length > 0) {
      for (const jobId of savedJobs.resumeIds) {
        const jobData = savedJobs.jobs.find((job) => job.id === jobId);
        if (!jobData) {
          logger.warn(`Skipped resuming job due to no information: ${jobId}`);
          continue;
        }
        logger.info(`Resuming ${jobData.type} job ${jobId} (${jobData.recordingId})`);
        const job = this.createJob(
          {
            continueJobId: jobId,
            id: jobData.recordingId,
            from: jobData.from,
            tags: jobData.tags,
            options: jobData.options,
            jobType: jobData.type,
            postTask: jobData.postTask
          },
          true
        );
        await job.run();
      }
    }

    if (savedJobs.savedIds.length > 0) {
      logger.info(`Loading saved jobs: ${savedJobs.savedIds.join(', ')}`);

      for (const jobId of savedJobs.savedIds) {
        const jobData = savedJobs.jobs.find((job) => job.id === jobId);
        if (!jobData) {
          logger.warn(`Skipped saved job due to no information: ${jobId}`);
          continue;
        }
        this.createSavedJob(jobData);
      }
    }

    if (this.jobs.size <= 0) return void logger.info('No jobs to resume from saved jobs.');
  }

  async init() {
    const recExists = await pathExists(REC_DIRECTORY);
    if (!recExists) logger.error(`Rec directory "${REC_DIRECTORY}" does not exist!`);

    const outputExists = await pathExists(OUTPUT_DIRECTORY);
    if (!outputExists) logger.error(`Output directory "${OUTPUT_DIRECTORY}" does not exist!`);

    if (!outputExists || !recExists) process.exit(1);

    logger.debug(`Rec Directory:\t${REC_DIRECTORY}`);
    logger.debug(`Output Directory:\t${OUTPUT_DIRECTORY}`);

    const tmpExists = await pathExists(TMP_DIRECTORY);
    if (tmpExists) await this.clearTmpDirectory();
    else await mkdir(TMP_DIRECTORY);

    await testProcessOptions();

    await this.loadSavedJobs();
    this.allowNewJobs = true;
    this.cron.start();
    if (QUEUE_SIZE) this.queueInterval = setInterval(() => this.queueIntervalTick(), 1_000);

    logger.info('Job manager ready.');
  }

  async onShutdown() {
    this.allowNewJobs = false;
    const allJobs = Array.from(this.jobs.values());
    const jobsToResume = this.cancelAllJobs('SERVICE_RESTARTING');
    const jobsToSave = Array.from(this.jobs.values()).filter((job) => job.status === 'complete' || job.status === 'queued');
    this.cron.stop();

    if (!SAVE_JOBS) return;

    const payload: SavedJobsJSON = {
      jobs: allJobs.map((j) => j.toJSON()),
      resumeIds: jobsToResume.map((job) => job.id),
      savedIds: jobsToSave.map((job) => job.id),
      timestamp: new Date().toISOString()
    };

    if (jobsToResume.length === 0 && jobsToSave.length === 0) return void logger.info('No jobs needed to save.');
    if (jobsToResume.length !== 0) logger.info(`Saving jobs to resume: ${jobsToResume.map((job) => `${job.id} (${job.recordingId})`).join(', ')}`);
    if (jobsToSave.length !== 0) logger.info(`Saving completed/queued jobs: ${jobsToSave.map((job) => `${job.id} (${job.recordingId})`).join(', ')}`);
    await writeSavedJobs(payload);
    logger.info('Saved jobs.');

    await wait(1000);
  }

  async clearTmpDirectory() {
    for (const folder of await fs.readdir(TMP_DIRECTORY)) {
      try {
        await fs.rm(path.join(TMP_DIRECTORY, folder), { recursive: true, force: true });
        logger.log(`Deleting temporary folder ${folder}`);
      } catch (e) {}
    }
  }

  async deleteJob(id: string, cancelReason = 'CANCELLED') {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'running') job.cancel(cancelReason);
    if (job.status === 'complete') {
      const stat = await job.getOutputStat();
      if (stat) {
        logger.log(`Deleting file ${job.outputFile} (${stat.size / 1000 / 1000} MB)`);
        await job.cleanup(true).catch(() => {});
      }
    }
    this.jobs.delete(job.id);
    return true;
  }

  async cleanCron() {
    const handledJobs: string[] = [];
    const now = Date.now();
    logger.log('Clean cron started...');

    if (KITCHEN_CLEAN_FILES) {
      // Handle jobs we have cached
      for (const job of this.jobs.values()) {
        if (now - job.createdAt.valueOf() > JOB_EXPIRATION) {
          const stat = await job.getOutputStat();
          if (job.status === 'running') job.cancel('JOB_EXPIRED');
          if (stat) {
            logger.log(`Deleting expired file ${job.getOutputPath()} (${stat.size / 1000 / 1000} MB)`);
            cleanedBytes.inc(stat.size);
          }
          await job.cleanup(true).catch(() => {});
          this.jobs.delete(job.id);
          handledJobs.push(job.id);
          cleanedFiles.inc();
        }
      }

      // Read from output folder as well, just so we don't get unhandled files
      for (const file of await fs.readdir(OUTPUT_DIRECTORY)) {
        const jobId = path.basename(file).split('.')[0];
        if (handledJobs.includes(jobId)) continue;
        try {
          const stat = await fs.stat(path.join(OUTPUT_DIRECTORY, file));
          if (stat.mtime.getTime() + JOB_EXPIRATION < now) {
            logger.log(`Deleting unhandled file ${file} since it expired (${stat.size / 1000 / 1000} MB)`);
            cleanedBytes.inc(stat.size);
            cleanedFiles.inc();
            await fs.unlink(path.join(OUTPUT_DIRECTORY, file));
          }
        } catch (e) {}
      }

      // Read from downloads folder as well, just so we don't get unhandled files
      for (const file of await fs.readdir(DOWNLOADS_DIRECTORY)) {
        const jobId = path.basename(file).split('.')[0];
        if (handledJobs.includes(jobId)) continue;
        try {
          const stat = await fs.stat(path.join(DOWNLOADS_DIRECTORY, file));
          if (stat.mtime.getTime() + JOB_EXPIRATION < now) {
            logger.log(`Deleting unhandled file ${file} since it expired (${stat.size / 1000 / 1000} MB)`);
            cleanedBytes.inc(stat.size);
            cleanedFiles.inc();
            await fs.unlink(path.join(DOWNLOADS_DIRECTORY, file));
          }
        } catch (e) {}
      }

      // Read from tmp directory for unhandled folders
      for (const folder of await fs.readdir(TMP_DIRECTORY)) {
        try {
          const stat = await fs.stat(path.join(TMP_DIRECTORY, folder));
          if (stat.mtime.getTime() + TMP_EXPIRATION < now) {
            logger.log(`Deleting unhandled tmp folder ${folder} since it expired`);
            await fs.rm(path.join(TMP_DIRECTORY, folder), { recursive: true, force: true });
          }
        } catch (e) {}
      }
    }

    logger.log('Clean cron finished.');
  }

  getQueueLength() {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'running' && !j.tags?.queueBypass).length;
  }

  async queueIntervalTick() {
    const runningJobs = this.getQueueLength();
    const queuedJobs = Array.from(this.jobs.values())
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt.valueOf() - b.createdAt.valueOf());
    let startedJobs = 0;
    let queuePosition = 0;

    for (const job of queuedJobs) {
      if (!QUEUE_SIZE || runningJobs + startedJobs < QUEUE_SIZE) {
        await job.run();
        if (QUEUE_SIZE) startedJobs++;
      } else {
        job.setState({ position: ++queuePosition });
      }
    }

    if (startedJobs) console.log(`Started ${startedJobs} jobs from queue.`);
  }
}
