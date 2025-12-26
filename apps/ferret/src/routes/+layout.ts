import '$lib/i18n';

import type { Load } from '@sveltejs/kit';
import { dictionary, locale, waitLocale } from 'svelte-i18n';

import { browser } from '$app/environment';
import { get as getCookie, localeCookieName } from '$lib/cookie';
import { device } from '$lib/device';
import { get } from 'svelte/store';

// svelte-i18n doesn't exactly wait for keys to be populated before finishing up, so this waits for that.
function waitForLocaleUpdate() {
  return new Promise((resolve) => {
    let completed = false;
    const unsub = dictionary.subscribe((d) => {
      if (completed) return unsub?.();
      for (const locale of Object.keys(d)) {
        const keys = Object.keys(d[locale]);
        if (keys.length !== 0) {
          completed = true;
          resolve(true);
          return;
        }
      }
    });

    // Timeout if this takes too long
    setTimeout(() => {
      unsub();
      if (!completed) {
        console.warn('Took too long to load the locale.');
        resolve(true);
        completed = true;
      }
    }, 500);
  });
}

export const load: Load = async () => {
  if (browser) {
    locale.set(getCookie(localeCookieName) || get(device)?.prefers?.language || 'en');
    window.plausible = window.plausible || ((e, o, ev) => (window.plausible.q = window.plausible.q || []).push([e, o, ev]));
    console.time('Locale Loaded');
  }
  await waitLocale();
  await waitForLocaleUpdate();
  if (browser) console.timeEnd('Locale Loaded');
};
