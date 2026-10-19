import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

import { localeCookieName } from '$lib/cookie';
import { resolveLocale } from '$lib/i18n';
import { RATE_LIMIT } from '$lib/server/config';
import { checkRateLimit, hitRateLimit, RateLimits } from '$lib/server/ratelimit';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

const CYRILLIC_LANGS = ['be', 'ru', 'uk'];

const handleLocale: Handle = async ({ event, resolve }) => {
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

const rateLimited = (retryAfter: number) => errorResponse(APIErrorCode.RATE_LIMITED, { status: 429, headers: { 'Retry-After': String(retryAfter) } });

const handleRateLimit: Handle = async ({ event, resolve }) => {
  if (!RATE_LIMIT || !event.url.pathname.startsWith('/api/v1/recordings/')) return resolve(event);

  const ip = event.getClientAddress();
  const isWrite = event.request.method === 'POST' || event.request.method === 'DELETE';

  // check all windows, hit global API ones
  const [failedKey, api, write] = await Promise.all([
    checkRateLimit(RateLimits.failedKey, ip),
    hitRateLimit(RateLimits.api, ip),
    isWrite ? hitRateLimit(RateLimits.write, ip) : null
  ]);
  const retryAfter = Math.max(failedKey ?? 0, api ?? 0, write ?? 0);
  if (retryAfter > 0) return rateLimited(retryAfter);

  const response = await resolve(event);
  // Wrong key or delete key
  if (response.status === 401) await hitRateLimit(RateLimits.failedKey, ip);
  return response;
};

export const handle = sequence(handleRateLimit, handleLocale);

// PM2 signalling
if (process.send && process.env.pm_id !== undefined) process.send('ready');
