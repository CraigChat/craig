import { Logger } from '@craig/logger';

const logger = new Logger('shard-manager', {
  level: process.env.LOGGER_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
});

export const debug = logger.debug.bind(logger);

export const log = logger.log.bind(logger);

export const info = logger.info.bind(logger);

export const warn = logger.warn.bind(logger);

export const error = logger.error.bind(logger);
