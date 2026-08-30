import './util/env.js';

import type { CronJob } from 'cron';

import { createJobs } from './jobs/index.js';
import { TASKS_IGNORE } from './util/config.js';
import { logger } from './util/logger.js';

const jobs = createJobs();
const crons: CronJob[] = [];

for (const job of jobs) {
  if (TASKS_IGNORE.has(job.name)) {
    logger.info(`Ignoring job ${job.name}.`);
    continue;
  }

  crons.push(job.start());
  logger.info(`Started job ${job.name} with schedule ${job.time}.`);
}

logger.info('Ready.');
if (process.send) process.send('ready');

function shutdown(signal: string) {
  logger.info(`Received ${signal}, stopping tasks.`);
  for (const cron of crons) cron.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
