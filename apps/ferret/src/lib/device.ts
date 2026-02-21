import { browser } from '$app/environment';
import { writable } from 'svelte/store';

interface DeviceInfo {
  userAgent: string;
  platform: {
    windows: boolean;
    mac: boolean;
    unix: boolean;
    iphone: boolean;
    android: boolean;
    mobile: boolean;
    desktop: boolean;
  };
  prefers: {
    language: string;
    reducedMotion: boolean;
    reducedTransparency: boolean;
  };
  capabilities: {
    showSaveFilePicker: boolean;
    showDirectoryPicker: boolean;
    minizel: boolean;
  };
}

const defaultDevice: DeviceInfo = {
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
  },
  capabilities: {
    showSaveFilePicker: false,
    showDirectoryPicker: false,
    minizel: false
  }
};

/** Reactive device store for use in Svelte components */
export const device = writable<DeviceInfo>({ ...defaultDevice });

export type DevicePlatform = keyof DeviceInfo['platform'];
export type DeviceCapability = keyof DeviceInfo['capabilities'];

export function processUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();

  const iphone = ua.includes('iphone os');
  const android = ua.includes('android');
  const firefox = ua.includes('firefox');

  device.update((d) => ({
    ...d,
    userAgent,
    platform: {
      windows: ua.includes('windows nt'),
      mac: ua.includes('mac os x') && !iphone,
      unix: (ua.includes('linux') || ua.includes('bsd')) && !android,
      iphone,
      android,
      mobile: iphone || android,
      desktop: !(iphone || android)
    },
    capabilities: {
      showSaveFilePicker: !firefox,
      showDirectoryPicker: !firefox,
      minizel: !firefox
    }
  }));
}

/** Refresh device capabilities - call once after mount to ensure reactivity */
export function refreshDeviceCapabilities() {
  if (!browser) return;

  device.update((d) => {
    const hasShowSaveFilePicker = typeof window.showSaveFilePicker === 'function';
    const hasShowDirectoryPicker = typeof window.showDirectoryPicker === 'function';

    return {
      ...d,
      prefers: {
        language: navigator.language.toLowerCase().slice(0, 2) || 'en',
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches
      },
      capabilities: {
        showSaveFilePicker: hasShowSaveFilePicker,
        showDirectoryPicker: hasShowDirectoryPicker,
        minizel: hasShowSaveFilePicker
      }
    };
  });
}

if (browser) {
  processUserAgent(navigator.userAgent);
  refreshDeviceCapabilities();
}
