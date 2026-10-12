import SentryCli from '@sentry/cli';

if (!process.env.SENTRY_AUTH_TOKEN) {
  console.log('Skipping Sentry source map upload: SENTRY_AUTH_TOKEN is not set');
} else {
  if (!process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    throw new Error('SENTRY_ORG and SENTRY_PROJECT are required when SENTRY_AUTH_TOKEN is set');
  }
  await new SentryCli().execute(['sourcemaps', 'upload', 'dist'], true);
}
