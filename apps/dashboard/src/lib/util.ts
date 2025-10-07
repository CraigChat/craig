import { type ClassValue, clsx } from 'clsx';
import { writable } from 'svelte/store';

import { defaultLocale } from './i18n';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function acronym(name: string) {
  return name
    .replace(/'s /g, ' ')
    .replace(/\w+/g, (e) => e[0])
    .replace(/\s/g, '');
}

interface MinimalDiscordUser {
  id: string;
  discriminator: string;
  avatar?: string | null;
}

export const INVITE_PERMISSIONS_BITFIELD = '68159488';

export const SUPPORT_SERVER_URL = 'https://discord.gg/craig';
export const CDN_URL = 'https://cdn.discordapp.com';
export const AVATAR_PLACEHOLDER = `${CDN_URL}/embed/avatars/0.png`;

export const CDNEndpoints = {
  BANNER: (id: string, hash: string) =>
    `${CDN_URL}/banners/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}`,
  CUSTOM_EMOJI: (emojiID: string) => `${CDN_URL}/emojis/${emojiID}.png`,
  DEFAULT_AVATAR: (n: number) => `${CDN_URL}/embed/avatars/${n}.png`,
  GUILD_AVATAR: (guildID: string, userID: string, hash: string, animate = true) =>
    `${CDN_URL}/guilds/${guildID}/users/${userID}/avatars/${hash}.${hash.startsWith('a_') && animate ? 'gif' : 'png'}`,
  ICON: (guildID: string, hash: string, animate = true) =>
    `${CDN_URL}/icons/${guildID}/${hash}.${hash.startsWith('a_') && animate ? 'gif' : 'png'}`,
  GUILD_TAG_BADGE: (guildID: string, badgeHash: string) =>
    `${CDN_URL}/guild-tag-badges/${guildID}/${badgeHash}.png`,
  ROLE_ICON: (roleID: string, roleIcon: string) =>
    `${CDN_URL}/role-icons/${roleID}/${roleIcon}.png`,
  SOUNDBOARD_SOUNDS: (soundID: string) => `${CDN_URL}/soundboard-sounds/${soundID}`,
  AVATAR: (userID: string, hash: string, animate = true) =>
    `${CDN_URL}/avatars/${userID}/${hash}.${hash.startsWith('a_') && animate ? 'gif' : 'png'}`,
  AVATAR_DECORATION: (userDecoration: string) =>
    `${CDN_URL}/avatar-decoration-presets/${userDecoration}.png`,
  NAMEPLATE: (asset: string, suffix = 'img.png') =>
    `${CDN_URL}/assets/collectibles/${asset}${suffix}`,
  CLAN_BADGE: (guildId: string, badge: string) => `${CDN_URL}/clan-badges/${guildId}/${badge}.png`
};

export function getAvatar(user: MinimalDiscordUser) {
  if (user.avatar && (user.avatar.startsWith(CDN_URL))) return user.avatar;
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

export type Translatable =
  | string
  | {
      t: string;
      values?: Record<string, any>;
    };

export function convertT(content: Translatable, t: (id: string, opts: any) => string) {
  if (typeof content === 'string') return content;
  return t(content.t, { values: content.values });
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
