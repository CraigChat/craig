import { init, register } from 'svelte-i18n';

import { browser } from '$app/environment';

import { get, localeCookieName } from './cookie';

export const defaultLocale = 'en';

const localeFiles = import.meta.glob('$locale/*/ferret.json');

for (const [file, importer] of Object.entries(localeFiles)) {
  const [_, lang] = file.split('/').reverse();
  register(lang, () => importer());
}

init({
  fallbackLocale: defaultLocale,
  initialLocale: browser ? get(localeCookieName) || window.navigator.language : defaultLocale,
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
