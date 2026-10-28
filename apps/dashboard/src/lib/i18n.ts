import { init, register } from 'svelte-i18n';

import { browser } from '$app/env';

import { get, localeCookieName } from './cookie';

export const defaultLocale = 'en';

const localeFiles = import.meta.glob('../../../../locale/*/dashboard.json');

export const supportedLocales: string[] = [];

for (const [file, importer] of Object.entries(localeFiles)) {
  const [_, lang] = file.split('/').reverse();
  supportedLocales.push(lang);
  register(lang, () => importer());
}

export function resolveLocale(tags: string[]) {
  for (const tag of tags) {
    const normalized = tag.trim().replace(/_/g, '-').toLowerCase();
    if (!normalized || normalized === 'null' || normalized === '*') continue;
    const match =
      supportedLocales.find((l) => l.toLowerCase() === normalized) ?? supportedLocales.find((l) => l.toLowerCase() === normalized.split('-')[0]);
    if (match) return match;
  }
  return defaultLocale;
}

function getLocale() {
  const cookie = get(localeCookieName);
  if (cookie === 'null') return undefined;
  return cookie;
}

init({
  fallbackLocale: defaultLocale,
  initialLocale: browser ? getLocale() || window.navigator.language || defaultLocale : defaultLocale,
  formats: {
    number: {
      scientific: { notation: 'scientific' },
      engineering: { notation: 'engineering' },
      compactLong: { notation: 'compact', compactDisplay: 'long' },
      compactShort: { notation: 'compact', compactDisplay: 'short' }
    },
    date: {
      all: { dateStyle: 'long', timeStyle: 'short' },
      short: { month: 'numeric', day: 'numeric', year: '2-digit' },
      medium: { month: 'short', day: 'numeric', year: 'numeric' },
      long: { month: 'long', day: 'numeric', year: 'numeric' },
      full: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    },
    time: {
      short: { hour: 'numeric', minute: 'numeric' },
      medium: { hour: 'numeric', minute: 'numeric', second: 'numeric' },
      long: {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
      },
      full: {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
      }
    }
  }
});
