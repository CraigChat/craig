import './env.js';

import * as Sentry from '@sentry/node';

import packageJson from '../package.json';
import { getSentryOptions } from './config.js';

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
    tracesSampleRate: sentryOpts.sampleRate ? parseFloat(sentryOpts.sampleRate) : 1.0
  });
