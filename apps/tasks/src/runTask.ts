import './util/env.js';

import { prisma } from '@craig/db';

import { createJob, jobFactories, type JobName } from './jobs/index.js';
import { logger } from './util/logger.js';

const jobName = process.argv[2] as JobName | undefined;

if (!jobName || !(jobName in jobFactories)) {
  logger.error(`Usage: pnpm -F @craig/tasks run-task <${Object.keys(jobFactories).join('|')}>`);
  process.exit(1);
}

try {
  const job = createJob(jobName);
  logger.info(`Running task ${job.name}.`);
  await job.run();
  logger.info(`Finished task ${job.name}.`);
} catch (e) {
  logger.error(`Task ${jobName} failed:`, e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
