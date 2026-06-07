import * as Sentry from '@sentry/node';
import { version } from '../../package.json';

Sentry.init({
  dsn: process.env.SENTRY_DSN_API,
  integrations: [new Sentry.Integrations.Http({ tracing: true })],

  environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'development',
  release: `craig-horse@${version}`,
  tracesSampleRate: process.env.SENTRY_SAMPLE_RATE_API ? parseFloat(process.env.SENTRY_SAMPLE_RATE_API) : 1.0
});

export function close() {
  return Sentry.close();
}
