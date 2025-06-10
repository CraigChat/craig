import type { Handle } from '@sveltejs/kit';
import { locale } from 'svelte-i18n';

import { localeCookieName } from '$lib/cookie';
import { processUserAgent } from '$lib/device';

const CYRILLIC_LANGS = ['be', 'ru', 'uk'];

export const handle: Handle = async ({ event, resolve }) => {
  const lang = event.cookies.get(localeCookieName) || event.request.headers.get('accept-language')?.split(',')[0]?.split(';')[0];
  const includeCyrillic = lang && CYRILLIC_LANGS.some((l) => lang.startsWith(l));
  if (lang && lang !== 'null') locale.set(lang);
  const userAgent = event.request.headers.get('user-agent');
  if (userAgent) processUserAgent(userAgent);
  return resolve(event, {
    preload(input) {
      // Preload cyrillic for specific langs
      if (includeCyrillic && input.type === 'font' && !!/\/.+-cyrillic-wght-normal\..+\.woff2$/.exec(input.path)) return true;
      return input.type === 'js' || input.type === 'css' || (input.type === 'font' && !!/\/.+-latin-wght-normal\..+\.woff2$/.exec(input.path));
    }
  });
};

// PM2 signalling
if (process.send && process.env.pm_id !== undefined) process.send('ready');
