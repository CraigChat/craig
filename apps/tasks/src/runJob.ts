import { join } from 'node:path';
import { TaskJob } from './types';

(async () => {
  const jobName = process.argv[2];
  if (!jobName) return void console.log('Usage: yarn run-job <job>', process.argv[1]);
  const jobPath = join(__dirname, 'jobs', `${jobName}.js`);
  const jobModule = await import(jobPath);
  const jobClass = jobModule.default;

  if (!jobClass) return void console.error('Failed to import job %s', jobName);

  const jobInstance = new jobClass();

  if (!(jobInstance instanceof TaskJob)) return void console.error('Job %s is not an instance of TaskJob', jobName);

  try {
    await jobInstance.run();
  } catch (err) {
    console.error(err);
  }
})();
