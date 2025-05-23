import config from 'config';
import { CronJob } from 'cron';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from './logger';
import { client } from './redis';
import { TaskJob } from './types';

const tasksConfig: {
  ignore: string[];
} = config.get('tasks');

(async () => {
  const logger = createLogger('tasks');
  const jobs = await readdir(join(__dirname, 'jobs'));

  logger.info('Found %d jobs: %s', jobs.length, jobs.map((j) => j.replace('.js', '')).join(', '));

  for (const job of jobs) {
    const jobPath = join(__dirname, 'jobs', job);
    const jobName = job.replace('.js', '');
    const jobModule = await import(jobPath);
    const jobClass = jobModule.default;

    if (tasksConfig && tasksConfig.ignore.includes(jobName)) {
      logger.info('Ignoring job %s', jobName);
      continue;
    }

    if (!jobClass) {
      logger.error('Failed to import job %s', jobName);
      continue;
    }

    const jobInstance = new jobClass();

    if (!(jobInstance instanceof TaskJob)) {
      logger.error('Job %s is not an instance of TaskJob', jobName);
      continue;
    }

    logger.info('Starting job %s', jobName);

    const jobCron = new CronJob(jobInstance.time, jobInstance._run.bind(jobInstance), null, false, config.get('timezone') as string);

    jobCron.start();
  }

  await client.connect();

  logger.info('Ready.');
  if (process.send) process.send('ready');
})();
