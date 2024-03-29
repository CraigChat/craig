import { createLogger, Logger } from './logger';

export class TaskJob {
  name: string;
  time: string;
  logger: Logger;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  userAgent = `CraigTasks (https://craig.chat ${require('../package.json').version}) Node.js/${process.version}`;

  constructor(name: string, time: string) {
    this.name = name;
    this.time = time;
    this.logger = createLogger(name);
  }

  async _run() {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(err);
    }
  }

  async run() {
    throw new Error(`Job ${this.name} has not been implemented yet.`);
  }
}
