import { h } from 'preact';
import { render } from 'preact/compat';
import * as Sentry from '@sentry/react';
import { Integrations } from '@sentry/tracing';

import 'tailwindcss/tailwind.css';
import 'react-tippy/dist/tippy.css';
import '@fontsource/red-hat-text/400.css';
import '@fontsource/red-hat-text/500.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/700.css';
import '@fontsource/ubuntu-mono/400.css';
import './index.sass';
import './i18n';
import App from './components/app';

if (process.env.SENTRY_DSN)
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [new Integrations.BrowserTracing()],
    release: process.env.VERSION,
    tracesSampleRate: process.env.SENTRY_SAMPLE_RATE ? parseFloat(process.env.SENTRY_SAMPLE_RATE) : 1.0
  });

document.addEventListener('DOMContentLoaded', () => {
  render(<App />, document.querySelector('#preact_root')!);
});
