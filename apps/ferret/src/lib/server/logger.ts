import { Logger } from '@craig/logger';

import { debug } from './config';

export const logger = new Logger(undefined, { level: debug ? 'debug' : 'info' });
