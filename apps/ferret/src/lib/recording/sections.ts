import type { Kitchen } from '@craig/types';
import type { IconifyIcon } from '@iconify/svelte';
import macIcon from '@iconify-icons/cib/apple';
import unixIcon from '@iconify-icons/cib/linux';
import windowsIcon from '@iconify-icons/cib/windows';
import auditionIcon from '@iconify-icons/file-icons/adobe-audition';
import audacityIcon from '@iconify-icons/file-icons/audacity';
import mp3Icon from '@iconify-icons/mdi/emoticon-frown';

import type { DevicePlatform } from '$lib/device';
import type { MinimalRecordingInfo } from '$lib/types';
import type { Translatable } from '$lib/util';

export type SectionButtons = {
  title: Translatable;
  features?: MinimalRecordingInfo['features'];
  showFor?: DevicePlatform[];
  buttons: SectionButton[];
}[];

export type SectionButton = {
  text: Translatable;
  suffix?: string;
  icon?: IconifyIcon;
  options?: {
    format?: Kitchen.FormatType;
    container?: Kitchen.ContainerType;
  };
  ennuizel?: number;
  allowNorm?: boolean;
  noIgnore?: boolean;
  showFor?: DevicePlatform[];
  features?: MinimalRecordingInfo['features'];
};

export type FocusedButton = SectionButton & { section: Translatable };

export const audioButtons: SectionButtons = [
  {
    title: { t: 'download.sections.mt' },
    buttons: [
      {
        icon: audacityIcon,
        text: { t: 'download.format_buttons.audacity' },
        options: { container: 'aupzip' },
        showFor: ['desktop'],
        allowNorm: true
      },
      {
        icon: auditionIcon,
        text: { t: 'download.format_buttons.adobe_audition' },
        options: { container: 'sesxzip' },
        showFor: ['desktop'],
        allowNorm: true
      },
      { text: 'FLAC', options: { format: 'flac' }, allowNorm: true },
      { text: 'wav', ennuizel: 5 },
      { text: 'AAC', suffix: '(MPEG-4)', options: { format: 'aac' }, allowNorm: true },
      { text: 'ALAC', suffix: '(Apple Lossless)', ennuizel: 6, showFor: ['mac'], allowNorm: true },
      { icon: mp3Icon, text: 'MP3', options: { format: 'mp3' }, features: ['mp3'], allowNorm: true }
    ]
  },
  {
    title: { t: 'download.sections.st' },
    buttons: [
      { text: 'FLAC', ennuizel: 0x30 },
      { text: 'wav', ennuizel: 0x35 },
      { text: 'AAC', suffix: '(MPEG-4)', ennuizel: 0x31 },
      { text: { t: 'download.format_buttons.other' }, ennuizel: 0x230 }
    ]
  },
  {
    title: { t: 'download.sections.stsm' },
    features: ['mix'],
    buttons: [
      { text: 'FLAC', options: { format: 'flac', container: 'mix' } },
      { text: 'Ogg Vorbis', options: { format: 'vorbis', container: 'mix' } },
      { text: 'AAC', suffix: '(MPEG-4)', options: { format: 'aac', container: 'mix' } },
      { icon: mp3Icon, text: 'MP3', options: { format: 'mp3', container: 'mix' }, features: ['mp3'] }
    ]
  },
  {
    title: { t: 'download.sections.local_processing' },
    showFor: ['desktop'],
    buttons: [
      {
        icon: windowsIcon,
        text: { t: 'download.format_buttons.win_executable' },
        options: { format: 'powersfx', container: 'exe' },
        showFor: ['windows'],
        noIgnore: true
      },
      { icon: macIcon, text: { t: 'download.format_buttons.mac_script' }, options: { format: 'powersfxm' }, showFor: ['mac'], noIgnore: true },
      { icon: unixIcon, text: { t: 'download.format_buttons.unix_script' }, options: { format: 'powersfxu' }, showFor: ['unix'], noIgnore: true }
    ]
  }
];
