import fs from 'node:fs/promises';
import * as path from 'node:path';

import type * as Kitchen from '@craig/types/kitchen';
import { EventEmitter } from 'eventemitter3';
import throttle from 'just-throttle';
import { nanoid } from 'nanoid';

import { DOWNLOADS_DIRECTORY, OUTPUT_DIRECTORY, QUEUE_SIZE, REC_DIRECTORY, TMP_DIRECTORY } from '../util/config.js';
import { formatError, FormatToExt, FormatToMime, pathExists } from '../util/index.js';
import logger from '../util/logger.js';
import { jobFinishedCount } from '../util/metrics.js';
import { deleteStreamOpen, pushJob, setStreamOpen } from '../util/redis.js';
import JobManager from './manager.js';
import { postTasks } from './postTasks.js';
import { processAvatarsJob } from './processing/avatars.js';
import { processRecordingJob } from './processing/recording.js';

export class Job extends EventEmitter {
  id: string;
  from?: string;
  tags?: Kitchen.JobTags;
  createdAt = new Date();
  tmpDir: string;
  recFileBase: string;
  outputFile: string;
  recordingId: string;
  continued: boolean;
  type: Kitchen.JobType;
  options?: Kitchen.CreateJobOptions['options'];
  postTask?: Kitchen.PostTask;
  postTaskOptions?: Kitchen.CreateJobOptions['postTaskOptions'];
  abortController = new AbortController();
  state: Kitchen.JobState = {};
  outputData: Kitchen.JobOutputData = {};

  status: Kitchen.JobStatus = 'idle';
  failReason?: string;
  outputSize?: number;
  startedAt?: Date;
  finishedAt?: Date;

  promise?: Promise<void>;
  push: (() => void) & { cancel: () => void; flush: () => void };

  constructor(
    opts: Kitchen.CreateJobOptions,
    private manager: JobManager
  ) {
    super();
    this.id = opts.continueJobId || nanoid(30);
    this.continued = !!opts.continueJobId;
    this.postTask = opts.postTask;
    this.recordingId = opts.id;
    this.type = opts.jobType;
    this.from = opts.from;
    this.tags = opts.tags;
    this.options = opts.options;
    this.postTaskOptions = opts.postTaskOptions;
    this.tmpDir = path.join(TMP_DIRECTORY, `cook-${opts.id}-${this.id}`);
    this.recFileBase = path.join(REC_DIRECTORY, `${opts.id}.ogg`);
    this.outputFile = path.join(OUTPUT_DIRECTORY, `${this.id}.${this.getExtension()}`);
    this.push = throttle(() => this._push(), 250, { leading: true });
  }

  static fromSaved(jobJson: Kitchen.JobJSON, manager: JobManager) {
    const newJob = new Job(
      {
        id: jobJson.recordingId,
        continueJobId: jobJson.id,
        jobType: jobJson.type,
        from: jobJson.from,
        tags: jobJson.tags,
        options: jobJson.options,
        postTaskOptions: jobJson.postTaskOptions
      },
      manager
    );
    newJob.outputFile = jobJson.outputFile;
    newJob.postTask = jobJson.postTask;
    newJob.status = jobJson.status;
    newJob.state = jobJson.state;
    newJob.createdAt = new Date(jobJson.createdAt);
    if (jobJson.outputSize) newJob.outputSize = jobJson.outputSize;
    if (jobJson.startedAt) newJob.startedAt = new Date(jobJson.startedAt);
    if (jobJson.finishedAt) newJob.finishedAt = new Date(jobJson.finishedAt);
    return newJob;
  }

  get exportString() {
    return [this.options?.format, this.options?.container].map((v) => v ?? '-').join(':');
  }

  getExtension() {
    switch (this.type) {
      case 'recording': {
        switch (this.options?.container) {
          case 'ogg':
          case 'matroska':
            return 'ogg';
          case 'exe':
            return 'exe';
          case 'mix': {
            const format = this.options?.format || 'flac';
            return FormatToExt[format];
          }
          case 'aupzip':
            return 'aup.zip';
          case 'sesxzip':
            return 'sesx.zip';
          case 'zip':
          default:
            switch (this.options?.format) {
              case 'powersfx':
              case 'powersfxu':
              case 'powersfxm':
              case 'wavsfx':
              case 'wavsfxu':
              case 'wavsfxm':
                return 'zip';
              default:
                return `${this.options?.format}.zip`;
            }
        }
      }
      case 'avatars': {
        switch (this.options?.format) {
          case 'mkvh264':
            return 'mkv.zip';
          case 'webmvp8':
          default:
            return 'webm.zip';
        }
      }
    }
  }

  getMimeType() {
    switch (this.type) {
      case 'recording': {
        switch (this.options?.container) {
          case 'ogg':
          case 'matroska':
            return 'audio/ogg';
          case 'exe':
            return 'application/vnd.microsoft.portable-executable';
          case 'mix': {
            const format = this.options?.format || FormatToMime.flac;
            return FormatToMime[format];
          }
          case 'aupzip':
          case 'sesxzip':
          case 'zip':
          default:
            return 'application/zip';
        }
      }
      case 'avatars':
        return 'application/zip';
    }
  }

  setState(state: this['state']) {
    this.state = state;
    this.emit('state', state);
    this.push();
  }

  setStatus(status: this['status']) {
    this.status = status;
    this.emit('status', status);
    if (['complete', 'error', 'cancelled'].includes(status)) {
      this.push.flush();
      jobFinishedCount.inc({
        job_type: this.type,
        job_export: this.exportString,
        status
      });
    }
    this.push();
  }

  _push() {
    const data: Kitchen.JobUpdate = {
      started: this.createdAt.valueOf(),
      now: Date.now(),
      status: this.status,
      failReason: this.failReason ?? null,
      state: this.state,
      outputData: this.outputData,
      outputFileName: path.basename(this.outputFile),
      outputSize: this.outputSize ?? null,
      finishedAt: this.finishedAt?.valueOf() ?? null
    };

    pushJob(this.id, data)
      .then(() => {})
      .catch(() => {});
  }

  async queue() {
    if (!QUEUE_SIZE || this.manager.getQueueLength() < QUEUE_SIZE || this.tags?.queueBypass) return this.run();
    this.setStatus('queued');
    await setStreamOpen(this.id);
    logger.info(`Queued job ${this.id} (${this.recordingId})`);
  }

  async run() {
    this.setStatus('running');
    this.setState({ type: 'starting' });
    await fs.mkdir(this.tmpDir, { recursive: true });
    await setStreamOpen(this.id);

    logger.info(`Starting job ${this.id} (${this.recordingId})`);
    this.startedAt = new Date();

    if (this.type === 'recording') {
      this.promise = processRecordingJob(this)
        .then(() => this.#doPostTask())
        .then(() => this.#onFinish())
        .catch((e) => this.#onError(e));
    } else if (this.type === 'avatars') {
      this.promise = processAvatarsJob(this)
        .then(() => this.#doPostTask())
        .then(() => this.#onFinish())
        .catch((e) => this.#onError(e));
    }
  }

  async #doPostTask() {
    if (!this.postTask || !postTasks[this.postTask]) return;
    await postTasks[this.postTask](this);
  }

  async #onFinish() {
    logger.info(`Job ${this.id} (${this.recordingId}) finished`);
    const stat = await this.getOutputStat();
    if (stat) this.outputSize = stat.size;
    this.finishedAt = new Date();
    this.setStatus('complete');

    await this.cleanup().catch(() => logger.error(`Failed to clean up ${this.id}`));
  }

  async #onError(e: any) {
    if (this.status !== 'cancelled') {
      this.failReason = formatError(e).slice(0, 2000);
      this.abortController.abort(this.failReason);
      this.setStatus('error');
      logger.info(`Job ${this.id} (${this.recordingId}) errored:`, e);
    }
    await this.cleanup(true).catch((e) => logger.error(`Failed to clean up ${this.id}`, e));
  }

  async cleanup(includeOutput = false) {
    if (await pathExists(this.tmpDir)) await fs.rm(this.tmpDir, { recursive: true, force: true });
    if (includeOutput) {
      if (await pathExists(this.outputFile)) await fs.rm(this.outputFile, { force: true });
      if (this.postTask === 'download') {
        const downloadPath = path.join(DOWNLOADS_DIRECTORY, path.basename(this.outputFile));
        if (await pathExists(downloadPath)) await fs.rm(downloadPath, { force: true });
      }
    }
    await deleteStreamOpen(this.id);
  }

  async getOutputStat() {
    if (this.postTask === 'download') {
      const downloadPath = path.join(DOWNLOADS_DIRECTORY, path.basename(this.outputFile));
      const stat = await fs.stat(downloadPath).catch(() => null);
      if (stat) return stat;
    }
    return await fs.stat(this.outputFile).catch(() => null);
  }

  getOutputPath() {
    if (this.postTask === 'download') return path.join(DOWNLOADS_DIRECTORY, path.basename(this.outputFile));
    return this.outputFile;
  }

  cancel(reason = 'CANCELLED') {
    this.failReason = reason;
    this.setStatus('cancelled');
    this.abortController.abort(reason);
    logger.info(`Job ${this.id} (${this.recordingId}) cancelled:`, reason);
  }

  toJSON(): Kitchen.JobJSON {
    return {
      id: this.id,
      from: this.from,
      tags: this.tags,
      recordingId: this.recordingId,
      continued: this.continued,
      postTask: this.postTask,
      postTaskOptions: this.postTaskOptions,
      createdAt: this.createdAt.toISOString(),
      outputFile: this.outputFile,
      outputFileName: path.basename(this.outputFile),
      type: this.type,
      options: this.options,
      status: this.status,
      outputData: this.outputData,
      failReason: this.failReason,
      state: this.state,
      outputSize: this.outputSize,
      startedAt: this.startedAt?.toISOString(),
      finishedAt: this.finishedAt?.toISOString()
    };
  }
}
