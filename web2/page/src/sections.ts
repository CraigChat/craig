import { IconifyIcon } from '@iconify/react';
import multiTrackIcon from '@iconify-icons/ic/round-clear-all';
import singleTrackIcon from '@iconify-icons/mdi/merge';
import audacityIcon from '@iconify-icons/file-icons/audacity';
import mp3Icon from '@iconify-icons/ic/baseline-music-off';
import { RecordingInfo } from './api';
import { PlatformInfo } from './util';

export interface Section {
  title: string;
  icon?: IconifyIcon;
  buttons: SectionButton[];
}

export interface SectionButton {
  text: string;
  suffix?: string;
  hidden?: boolean;
  icon?: IconifyIcon;
  format?: string;
  container?: string;
  dynaudnorm?: boolean;
  ennuizel?: number;
}

export const getDownloadsSection = (info: RecordingInfo, platform: PlatformInfo) => {
  const sections: Section[] = [
    {
      title: 'Multi-track',
      icon: multiTrackIcon,
      buttons: [
        {
          icon: audacityIcon,
          text: 'Audacity Project',
          format: 'flac',
          container: 'aupzip'
        },
        {
          text: 'FLAC',
          format: 'flac'
        },
        {
          text: 'wav',
          ennuizel: 5
        },
        {
          text: 'AAC',
          suffix: '(MPEG-4)',
          format: 'aac'
        },
        {
          text: 'ALAC',
          suffix: '(Apple Lossless)',
          ennuizel: 6,
          hidden: !platform.macosx && !platform.showHidden
        },
        {
          icon: mp3Icon,
          text: 'MP3',
          format: 'mp3',
          hidden: !info.features.mp3
        }
      ]
    },
    {
      title: 'Single-track Mixed',
      icon: singleTrackIcon,
      buttons: [
        {
          text: 'FLAC',
          ennuizel: 0x30
        },
        {
          text: 'wav',
          ennuizel: 0x35
        },
        {
          text: 'AAC',
          suffix: '(MPEG-4)',
          ennuizel: 0x31
        },
        {
          text: 'Other',
          ennuizel: 0x230
        }
      ]
    },
    {
      title: 'Single-track Smart Mix',
      icon: singleTrackIcon,
      buttons: [
        {
          text: 'FLAC',
          format: 'flac',
          container: 'mix',
          hidden: !info.features.mix
        },
        {
          text: 'Ogg Vorbis',
          format: 'vorbis',
          container: 'mix',
          hidden: !info.features.mix
        },
        {
          text: 'AAC',
          suffix: '(MPEG-4)',
          format: 'aac',
          container: 'mix',
          hidden: !info.features.mix
        },
        {
          icon: mp3Icon,
          text: 'MP3',
          format: 'mp3',
          container: 'mix',
          hidden: !info.features.mix || !info.features.mp3
        }
      ]
    }
  ];

  return sections.filter(section => section.buttons.some(button => !button.hidden));
};

