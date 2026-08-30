import { browser } from '$app/environment';

const device = {
  userAgent: '(SvelteKit server render)',
  platform: {
    windows: false,
    mac: false,
    unix: false,
    iphone: false,
    android: false,
    mobile: false,
    desktop: true
  },
  prefers: {
    language: 'en',
    reducedMotion: false,
    reducedTransparency: false
  }
};

export type DevicePlatform = keyof (typeof device)['platform'];

export function processUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();

  const iphone = ua.includes('iphone os');
  const android = ua.includes('android');
  device.platform = {
    windows: ua.includes('windows nt'),
    mac: ua.includes('mac os x') && !iphone,
    unix: (ua.includes('linux') || ua.includes('bsd')) && !android,

    iphone,
    android,

    mobile: iphone || android,
    desktop: !(iphone || android)
  };

  device.userAgent = userAgent;
}

if (browser) {
  processUserAgent(navigator.userAgent.toLowerCase());

  device.prefers = {
    language: navigator.language.toLowerCase().slice(0, 2) || 'en',
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches
  };
}

export { device };
