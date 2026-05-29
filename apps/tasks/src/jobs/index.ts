import { CleanRecordingsJob } from './cleanRecordings.js';
import type { TaskJob } from './job.js';
import { RefreshPatronsJob } from './refreshPatrons.js';

export const jobFactories = {
  cleanRecordings: () => new CleanRecordingsJob(),
  refreshPatrons: () => new RefreshPatronsJob()
} satisfies Record<string, () => TaskJob>;

export type JobName = keyof typeof jobFactories;

export function createJob(name: JobName) {
  return jobFactories[name]();
}

export function createJobs() {
  return Object.values(jobFactories).map((factory) => factory());
}
