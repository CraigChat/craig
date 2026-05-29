import { CronJob } from 'cron';

import { TASKS_TIMEZONE } from '../util/config.js';
import { logger as rootLogger } from '../util/logger.js';

export abstract class TaskJob {
  readonly logger = rootLogger;

  #running = false;

  constructor(
    readonly name: string,
    readonly time: string
  ) {}

  start() {
    const cron = new CronJob(this.time, () => this.runOnce(), null, false, TASKS_TIMEZONE);
    cron.start();
    return cron;
  }

  async runOnce() {
    if (this.#running) {
      this.logger.warn(`Skipping ${this.name}; previous run is still active.`);
      return;
    }

    this.#running = true;
    const start = Date.now();
    try {
      this.logger.info(`Starting ${this.name}.`);
      await this.run();
      this.logger.info(`Finished ${this.name} in ${((Date.now() - start) / 1000).toFixed(2)}s.`);
    } catch (e) {
      this.logger.error(`${this.name} failed:`, e);
    } finally {
      this.#running = false;
    }
  }

  abstract run(): Promise<void>;
}
