import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { locale } from 'svelte-i18n';

import { localeCookieName } from '$lib/cookie';
import { processUserAgent } from '$lib/device';
import { RATE_LIMIT } from '$lib/server/config';
import { checkRateLimit, hitRateLimit, RateLimits } from '$lib/server/ratelimit';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

const CYRILLIC_LANGS = ['be', 'ru', 'uk'];

const handleLocale: Handle = async ({ event, resolve }) => {
  const lang = event.cookies.get(localeCookieName) || event.request.headers.get('accept-language')?.split(',')[0]?.split(';')[0];
  const includeCyrillic = lang && CYRILLIC_LANGS.some((l) => lang.startsWith(l));
  if (lang && lang !== 'null' && lang !== '*') locale.set(lang);
  const userAgent = event.request.headers.get('user-agent');
  if (userAgent) processUserAgent(userAgent);
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
