import { Counter, Gauge } from '@craig/metrics';

import type JobManager from '../jobs/manager.js';

export function registerWithManager(manager: JobManager) {
  new Gauge({
    name: 'craig_kitchen_jobs_running',
    help: 'Currently running jobs',
    collect() {
      this.set(Array.from(manager.jobs.values()).filter((job) => job.status === 'running').length);
    }
  });
  new Gauge({
    name: 'craig_kitchen_jobs_queued',
    help: 'Currently queued jobs',
    collect() {
      this.set(Array.from(manager.jobs.values()).filter((job) => job.status === 'queued').length);
    }
  });
}

export const jobCount = new Counter({
  name: 'craig_kitchen_jobs_total',
  help: 'Total amount of jobs created',
  labelNames: ['job_type', 'job_export'] as const
});

export const jobFinishedCount = new Counter({
  name: 'craig_kitchen_jobs_finished_total',
  help: 'Total amount of jobs finished',
  labelNames: ['job_type', 'job_export', 'status'] as const
});

export const uploadCount = new Counter({
  name: 'craig_kitchen_upload_total',
  help: 'Total amount of uploads attemped',
  labelNames: ['service', 'status'] as const
});

export const cleanedFiles = new Counter({
  name: 'craig_kitchen_cleaned_files_total',
  help: 'Total amount of files cleaned from cron'
});

export const cleanedBytes = new Counter({
  name: 'craig_kitchen_cleaned_bytes_total',
  help: 'Total amount of bytes cleaned from cron'
});
