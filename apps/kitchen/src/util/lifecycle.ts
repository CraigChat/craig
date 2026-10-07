import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { inspect } from 'node:util';

import type JobManager from '../jobs/manager.js';
import logger from './logger.js';

const bootId = randomUUID();

export function logLifecycle(event: string, details: Record<string, unknown> = {}) {
  logger.info(`[Kitchen lifecycle] event=${event}`, { bootId, pid: process.pid, uptimeSeconds: process.uptime(), ...details });
}

export function logEmergency(
  event: 'uncaught_exception' | 'startup_failed' | 'shutdown_failed' | 'shutdown_finished' | 'process_exit',
  details: Record<string, unknown> = {}
) {
  try {
    const prefix = `${new Date().toISOString()} [Kitchen lifecycle] event=${event} bootId=${bootId} pid=${process.pid}`;
    const lines = [`${prefix} uptimeSeconds=${process.uptime().toFixed(3)}`];
    for (const [key, value] of Object.entries(details)) {
      const text = typeof value === 'string' ? value : inspect(value, { depth: null, colors: false, compact: false, breakLength: 120 });
      const [first, ...rest] = text.split('\n');
      lines.push(`${prefix}   ${key}: ${first}`, ...rest.map((line) => `${prefix}     ${line}`));
    }
    writeSync(2, lines.join('\n') + '\n');
  } catch {}
}

export function installLifecycleLogging(manager: JobManager) {
  logLifecycle('kitchen_boot', { nodeVersion: process.version, pm2Id: process.env.pm_id });
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logEmergency('uncaught_exception', { origin, stack: error.stack, queue: manager.getDiagnostics() });
  });
  process.on('warning', (warning) => {
    logger.warn('[Kitchen lifecycle] event=process_warning', {
      bootId,
      pid: process.pid,
      name: warning.name,
      message: warning.message,
      stack: warning.stack
    });
  });
  process.once('beforeExit', (code) => logLifecycle('before_exit', { code, queue: manager.getDiagnostics() }));
  process.on('exit', (code) => logEmergency('process_exit', { code }));
}
