import type { Handle, ServerInit } from '@sveltejs/kit';

import { env } from '$env/dynamic/private';
import { localeCookieName } from '$lib/cookie';
import { resolveLocale } from '$lib/i18n';
import { requiredEnv } from '$lib/server/env';
import { assertJwtSecret } from '$lib/server/jwt';

export const init: ServerInit = () => {
  assertJwtSecret(requiredEnv('JWT_SECRET', env.JWT_SECRET));
};

const CYRILLIC_LANGS = ['be', 'ru', 'uk'];

export const handle: Handle = async ({ event, resolve }) => {
  const acceptLanguages =
    event.request.headers
      .get('accept-language')
      ?.split(',')
      .map((l) => l.split(';')[0]) ?? [];
  const lang = resolveLocale([event.cookies.get(localeCookieName) ?? '', ...acceptLanguages]);
  event.locals.lang = lang;
  const includeCyrillic = CYRILLIC_LANGS.includes(lang);
  return resolve(event, {
    preload(input) {
      // Preload cyrillic for specific langs
      if (includeCyrillic && input.type === 'font' && !!/\/.+-cyrillic-wght-normal\..+\.woff2$/.exec(input.path)) return true;
      return (
        input.type === 'js' ||
        input.type === 'css' ||
        (input.type === 'font' && !!/\/(.+-latin-wght-normal|PublicSans-variable)\.[^/]+\.woff2$/.exec(input.path))
      );
    }
  });
};

// PM2 signalling
if (process.send && process.env.pm_id !== undefined) process.send('ready');
