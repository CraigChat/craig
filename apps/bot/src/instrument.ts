import './env.js';

import * as Sentry from '@sentry/node';

import packageJson from '../package.json';
import { getSentryOptions } from './config.js';

const SENSITIVE_KEYS = new Set(['token', 'interactiontoken']);
function scrubTokens<T>(value: T, depth = 0): T {
  if (!value || typeof value !== 'object' || depth > 10) return value;
  if (Array.isArray(value)) return value.map((v) => scrubTokens(v, depth + 1)) as T;
  const out: Record<string, any> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    out[key] = scrubTokens(v, depth + 1);
  }
  return out as T;
}

const sentryOpts = getSentryOptions();
if (sentryOpts)
  Sentry.init({
    dsn: sentryOpts.dsn,
    integrations: [Sentry.rewriteFramesIntegration({ root: process.cwd() }), Sentry.prismaIntegration()],
    dataCollection: {
      cookies: false,
      httpHeaders: { deny: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'] },
      httpBodies: [],
      databaseQueryData: false
    },
    environment: sentryOpts.env || process.env.NODE_ENV || 'development',
    release: `craig-bot@${packageJson.version}`,
    beforeSend(event) {
      if (event.extra) event.extra = scrubTokens(event.extra);
      if (event.contexts) event.contexts = scrubTokens(event.contexts);
      return event;
    },
    tracesSampleRate: sentryOpts.sampleRate ? parseFloat(sentryOpts.sampleRate) : 1.0
  });
