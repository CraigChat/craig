import './util/env.js';

import { prisma, type User } from '@craig/db';
import { startMetricsServer } from '@craig/metrics';
import type {
  ContainerType,
  CreateJobOptions,
  FormatType,
  KitchenHealthResponse,
  KitchenJobsResponse,
  KitchenStatsResponse
} from '@craig/types/kitchen';
import fastify from 'fastify';
import path from 'path';
import { writeHeapSnapshot } from 'v8';

import JobManager from './jobs/manager.js';
import { dropboxPreflight } from './jobs/upload/dropbox.js';
import { googlePreflight } from './jobs/upload/google.js';
import { microsoftPreflight } from './jobs/upload/microsoft.js';
import { REC_DIRECTORY } from './util/config.js';
import logger from './util/logger.js';
import { registerWithManager, uploadCount } from './util/metrics.js';
import { getDuration } from './util/process.js';

const debug = process.env.NODE_ENV !== 'production';
const app = fastify({
  logger: debug,
  ignoreTrailingSlash: true
});
const jobManager = new JobManager();

app.get('/health', async (req, reply) => {
  return reply.status(200).send({ responseTime: reply.elapsedTime } as KitchenHealthResponse);
});

app.get('/stats', async (req, reply) => {
  return reply.status(200).send({
    allowNewJobs: jobManager.allowNewJobs,
    jobCount: {
      finishedJobs: Array.from(jobManager.jobs.values()).filter((job) => job.status === 'complete').length,
      runningJobs: Array.from(jobManager.jobs.values()).filter((job) => job.status === 'running').length,
      total: jobManager.jobs.size
    }
  } as KitchenStatsResponse);
});

app.post('/settings', async (req, reply) => {
  const body = req.body as any;
  if (typeof body !== 'object') return reply.status(400).send({ error: 'Invalid body' });

  if ('allowNewJobs' in body && typeof body.allowNewJobs === 'boolean') jobManager.allowNewJobs = body.allowNewJobs;

  return reply.status(200).send({
    allowNewJobs: jobManager.allowNewJobs
  });
});

app.post('/_writeHeapSnapshot', async (req, reply) => {
  if (req.headers['x-real-ip'] || req.headers['cf-connecting-ip']) return reply.status(401).send({ ok: false });
  const filename = writeHeapSnapshot();
  return reply.status(200).send({ filename });
});

app.get('/jobs', async (req, reply) => {
  return reply.status(200).send({ jobs: Array.from(jobManager.jobs.values()).map((j) => j.toJSON()) } as KitchenJobsResponse);
});

app.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
  const job = jobManager.jobs.get(req.params.id);
  if (!job) return reply.status(400).send({ error: 'Job not found' });

  return reply.status(200).send(job);
});

app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (req, reply) => {
  const job = jobManager.jobs.get(req.params.id);
  if (!job) return reply.status(400).send({ error: 'Job not found' });

  const body = req.body as any;
  const reason =
    typeof body === 'string' ? body : typeof body === 'object' && 'reason' in body && typeof body.reason === 'string' ? body.reason : undefined;

  if (job.status === 'running') job.cancel(reason);

  return reply.status(200).send(job);
});

app.delete<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
  const job = jobManager.jobs.get(req.params.id);
  if (!job) return reply.status(400).send({ error: 'Job not found' });
  const success = jobManager.deleteJob(job.id);
  if (!success) return reply.status(400).send({ error: 'Job not found' });

  return reply.status(200).send(job);
});

app.post('/jobs', async (req, reply) => {
  const opts: CreateJobOptions = req.body as any;

  // Check options
  if (typeof opts !== 'object') return reply.status(400).send({ error: 'Invalid options' });

  // Check job type
  if (!['recording', 'avatars'].includes(opts.jobType)) return reply.status(400).send({ error: 'Invalid job type' });

  // Check recording ID
  if (typeof opts.id !== 'string' || opts.id.includes('/') || opts.id.includes('\\') || opts.id.includes('.'))
    return reply.status(400).send({ error: 'Invalid recording ID' });
  if (!(await jobManager.recordingExists(opts.id))) return reply.status(404).send({ error: 'Non-existant recording' });

  try {
    const job = jobManager.createJob(opts);
    await job.queue();
    return reply.status(200).send(job);
  } catch (e) {
    return reply.status(400).send({ error: (e as Error).message });
  }
});

app.get<{ Params: { id: string } }>('/recordings/:id', async (req, reply) => {
  return reply.status(200).send({
    jobs: Array.from(jobManager.jobs.values())
      .filter((job) => job.recordingId === req.params.id)
      .map((job) => job.toJSON())
  } as KitchenJobsResponse);
});

app.get<{ Params: { id: string } }>('/recordings/:id/duration', async (req, reply) => {
  const { id } = req.params;

  // Check recording ID
  if (typeof id !== 'string' || id.includes('/') || id.includes('\\') || id.includes('.'))
    return reply.status(400).send({ error: 'Invalid recording ID' });
  if (!(await jobManager.recordingExists(id))) return reply.status(404).send({ error: 'Non-existant recording' });

  try {
    const recFileBase = path.join(REC_DIRECTORY, `${id}.ogg`);
    const duration = await getDuration({ recFileBase });
    return reply.status(200).send({ ok: true, duration: parseFloat(duration) });
  } catch (e) {
    return reply.status(500).send({ ok: false });
  }
});

app.post<{ Params: { id: string; userId: string } }>('/recordings/:id/upload/:userId', async (req, reply) => {
  const { id, userId } = req.params;

  let user: User | null = null;
  function send(status: number, payload?: unknown) {
    uploadCount.inc({ service: user?.driveService, status });
    return reply.status(status).send(payload);
  }

  // Check recording ID
  if (typeof id !== 'string' || id.includes('/') || id.includes('\\') || id.includes('.')) return send(400, { error: 'Invalid recording ID' });
  if (!(await jobManager.recordingExists(id))) return send(404, { error: 'Non-existant recording' });

  // Check user ID
  if (typeof userId !== 'string' || !/^\d+$/.test(userId)) return send(400, { error: 'Invalid user ID' });

  // Check if job already exists
  if (
    Array.from(jobManager.jobs.values()).find(
      (job) => job.recordingId === id && job.from === 'upload' && (job.status === 'running' || job.status === 'queued')
    )
  )
    return send(400, { error: 'Recording already being uploaded' });

  user = await prisma.user.findFirst({ where: { id: userId } });
  if (!user) return send(204); // Not found
  if (user.rewardTier === 0) return send(204); // Not allowed
  if (!user.driveEnabled) return send(204); // Not enabled
  if (user.rewardTier !== -1 && user.rewardTier < 20 && user.driveContainer === 'mix') return send(204); // Mix unavailable with current tier

  const postTaskOptions: CreateJobOptions['postTaskOptions'] = { userId };
  switch (user.driveService) {
    case 'google': {
      const result = await googlePreflight(userId);
      if (!result) return send(400, { error: 'auth_invalidated' });
      postTaskOptions.googleFolderId = result.folderId;
      break;
    }
    case 'microsoft': {
      if (!(await microsoftPreflight(userId))) return send(400, { error: 'auth_invalidated' });
      break;
    }
    case 'dropbox': {
      if (!(await dropboxPreflight(userId))) return send(400, { error: 'auth_invalidated' });
      break;
    }
  }

  const format: FormatType = (user.driveFormat as FormatType) || 'flac';
  const container: ContainerType = (user.driveContainer as ContainerType) || 'zip';

  try {
    logger.info(`Creating upload on recording ${id} for user ${userId}`);
    const job = jobManager.createJob({
      jobType: 'recording',
      id,
      from: 'upload',
      postTask: 'upload',
      postTaskOptions,
      tags: { queueBypass: true },
      options: {
        format,
        container
      }
    });
    await job.run();
    return send(200, job);
  } catch (e) {
    return send(500, { error: (e as Error).message });
  }
});

app.listen(
  {
    port: process.env.PORT ? parseInt(process.env.PORT) : 9000,
    host: process.env.HOST || 'localhost'
  },
  async (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }

    logger.info(`Serving at ${address} (${process.env.NODE_ENV})`);
    await jobManager.init();
    registerWithManager(jobManager);
    startMetricsServer(logger);
    if (process.send && process.env.pm_id !== undefined) process.send('ready');
  }
);

process.on('SIGINT', async () => {
  logger.info('SIGINT recieved, shutting down...');
  await jobManager.onShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM recieved, shutting down...');
  await jobManager.onShutdown();
  process.exit(0);
});
