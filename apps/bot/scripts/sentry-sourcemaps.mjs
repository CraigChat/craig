#!/usr/bin/env node
import SentryCli from '@sentry/cli';

const requiredVariables = ['SENTRY_ORG', 'SENTRY_PROJECT'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

const cli = new SentryCli();
await cli.execute(['sourcemaps', 'inject', 'dist'], 'rejectOnError');

if (missingVariables.length === requiredVariables.length) {
  console.log('Skipping Sentry source map upload: configure SENTRY_ORG and SENTRY_PROJECT in sentry.env or the environment');
} else if (missingVariables.length) {
  console.warn(`Skipping Sentry source map upload: missing ${missingVariables.join(', ')}`);
} else {
  try {
    await cli.execute(['sourcemaps', 'upload', 'dist'], 'rejectOnError');
  } catch {
    console.warn('Sentry source map upload failed; continuing the build.');
  }
}
