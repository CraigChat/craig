import type { RecordingUser } from '@craig/types/recording';
import { writable } from 'svelte/store';

import { defaultLocale } from './i18n';
import type { MinimalJobInfo } from './types';

export function acronym(name: string) {
  return name
    .replace(/'s /g, ' ')
    .replace(/\w+/g, (e) => e[0])
    .replace(/\s/g, '');
}

interface MinimalDiscordUser {
  id: string;
  discriminator: string;
  avatar?: string;
  avatarUrl?: string;
}

export const SUPPORT_SERVER_URL = 'https://discord.gg/craig';
export const CDN_URL = 'https://cdn.discordapp.com';
export const AVATAR_PLACEHOLDER = `${CDN_URL}/embed/avatars/0.png`;

export function getAvatar(user: MinimalDiscordUser) {
  if (user.avatar && (user.avatar.startsWith(CDN_URL) || user.avatar.startsWith('data:'))) return user.avatar;
  if (user.avatarUrl?.startsWith(CDN_URL)) return user.avatarUrl;
  return `${CDN_URL}/avatars/${user.id}/${user.avatar}.png`;
}

export function getDefaultAvatar(user: MinimalDiscordUser) {
  const defaultAvatar = getDefaultAvatarNumber(user);
  return `${CDN_URL}/embed/avatars/${defaultAvatar}.png`;
}

export function getDefaultAvatarNumber(user: MinimalDiscordUser) {
  if (!/^[0-9]+$/.test(user.discriminator + user.id)) return 0;
  if (user.discriminator === '0') return Number((BigInt(user.id) >> 22n) % 6n);
  return parseInt(user.discriminator) % 5;
}

export function getCreatedAt(id: string) {
  return getDiscordEpoch(id) + 1420070400000;
}

export function getDiscordEpoch(id: string) {
  return Math.floor(Math.floor(Number(BigInt(id) / 4194304n)));
}

export function formatUser(user: RecordingUser) {
  return `${user.track}-${(user.discriminator === '0' ? user.username : `${user.username}#${user.discriminator}`).replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formattedSize = (bytes / Math.pow(k, i)).toFixed(2);
  return `${formattedSize}${units[i]}`;
}

const FORMAT_MILLISECONDS_UNITS = [
  { label: 'd', value: 86400000 },
  { label: 'h', value: 3600000 },
  { label: 'm', value: 60000 },
  { label: 's', value: 1000 },
  { label: 'ms', value: 1 }
];

export function formatMilliseconds(milliseconds: number, parts: number = 1): string {
  let remainingTime = milliseconds;
  const result: string[] = [];

  for (const { label, value } of FORMAT_MILLISECONDS_UNITS) {
    if (remainingTime >= value) {
      const unitCount = Math.floor(remainingTime / value);
      result.push(`${unitCount}${label}`);
      remainingTime %= value;

      if (result.length === parts) {
        break;
      }
    }
  }

  return result.join(' ');
}

export function relativeTime(rtf: Intl.RelativeTimeFormat, seconds: number) {
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  if (Math.abs(seconds) <= 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) <= 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (Math.abs(seconds) <= 2592000) return rtf.format(Math.round(seconds / 86400), 'day');
  return rtf.format(Math.round(seconds / 2592000), 'month');
}

export function convertToTimeMark(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds}` : `${remainingSeconds}`;

  return `${hours === 0 ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}

export const currentTime = writable(Math.floor(Date.now() / 1000), (set, update) => {
  const interval = setInterval(() => update((time) => (time += 1)), 1000);
  return () => clearInterval(interval);
});

export function getNameFromJob(job: MinimalJobInfo, t: (id: string) => string) {
  switch (job.type) {
    case 'recording': {
      if (job.options.container === 'aupzip') return `${t('download.sections.audio')} / ${t('download.format_buttons.audacity')}`;
      else if (job.options.container === 'sesxzip') return `${t('download.sections.audio')} / ${t('download.format_buttons.adobe_audition')}`;
      else if (job.options.container === 'exe') return `${t('download.sections.audio')} / ${t('download.format_buttons.win_executable')}`;
      else if (job.options.container === 'mix')
        return `${t('download.sections.audio')} / ${job.options.format === 'vorbis' ? 'Ogg Vorbis' : (job.options.format || 'flac').toUpperCase()} (${t('download.sections.stsm')})`;
      else if (job.options.format === 'powersfx') return `${t('download.sections.audio')} / ${t('download.format_buttons.win_executable')}`;
      else if (job.options.format === 'powersfxm') return `${t('download.sections.audio')} / ${t('download.format_buttons.mac_script')}`;
      else if (job.options.format === 'powersfxu') return `${t('download.sections.audio')} / ${t('download.format_buttons.unix_script')}`;
      return `${t('download.sections.audio')} / ${(job.options.format || 'flac').toUpperCase()} (${t('download.sections.mt')})`;
    }
    case 'avatars': {
      if (job.options.format === 'mkvh264') return `${t('download.avatar_overlays.name')} / MKV`;
      else if (job.options.format === 'webmvp8') return `${t('download.avatar_overlays.name')} / WebM`;
      return `${t('download.avatar_overlays.name')} / ${(job.options.format || '').toUpperCase()}`;
    }
  }
  return '';
}

export type Translatable =
  | string
  | {
      t: string;
      values?: Record<string, any>;
    };

export function convertT(content: Translatable, t: (id: string, opts: any) => string) {
  if (typeof content === 'string') return content;

  return t(content.t, {
    values: content.values
  });
}

export function capitalize(str: string): string {
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getRTF(locale?: string | undefined | null, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  let localeValid = true;
  // HOTFIX, I guess locale set strings could be null?
  if (locale === 'null') localeValid = false;
  else if (locale) {
    try {
      Intl.getCanonicalLocales(locale);
    } catch {
      console.info(`Invalid locale found: ${locale}`);
      localeValid = false;
    }
  }

  return new Intl.RelativeTimeFormat(localeValid && locale ? locale : defaultLocale, options);
}
