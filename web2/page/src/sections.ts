import { IconifyIcon } from '@iconify/react';
import multiTrackIcon from '@iconify-icons/ic/round-clear-all';
import singleTrackIcon from '@iconify-icons/mdi/merge';
import audacityIcon from '@iconify-icons/file-icons/audacity';
import mp3Icon from '@iconify-icons/ic/baseline-music-off';
import computerIcon from '@iconify-icons/ic/baseline-computer';
import windowsIcon from '@iconify-icons/cib/windows';
import macIcon from '@iconify-icons/cib/apple';
import unixIcon from '@iconify-icons/cib/linux';
import rawIcon from '@iconify-icons/ic/round-insert-drive-file';
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
          container: 'aupzip',
          hidden: (platform.iphone || platform.android) && !platform.showHidden
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

export const getOtherFormatsSection = (info: RecordingInfo, platform: PlatformInfo) => {
  const sections: Section[] = [
    {
      title: 'Multi-track',
      icon: multiTrackIcon,
      buttons: [
        {
          text: 'FLAC',
          ennuizel: 0
        },
        {
          text: 'AAC',
          suffix: '(MPEG-4)',
          ennuizel: 1
        },
        {
          text: 'Other',
          ennuizel: 0x200
        },
      ]
    },
    {
      title: 'Multi-track (other formats)',
      icon: multiTrackIcon,
      buttons: [
        {
          text: 'Ogg FLAC',
          format: 'oggflac'
        },
        {
          text: 'HE-AAC',
          format: 'heaac'
        },
        {
          text: 'Opus',
          format: 'opus'
        },
        {
          text: 'Ogg Vorbis',
          format: 'vorbis'
        },
        {
          text: 'ADPCM wav',
          format: 'adpcm'
        },
        {
          text: '8-bit wav',
          format: 'wav8'
        }
      ]
    },
    {
      title: 'Multi-track smart-leveled',
      icon: multiTrackIcon,
      buttons: [
        {
          icon: audacityIcon,
          text: 'Audacity Project',
          format: 'flac',
          container: 'aupzip',
          dynaudnorm: true,
          hidden: (platform.iphone || platform.android) && !platform.showHidden
        },
        {
          text: 'FLAC',
          format: 'flac',
          dynaudnorm: true
        },
        {
          text: 'wav',
          ennuizel: 0x25
        },
        {
          text: 'AAC',
          suffix: '(MPEG-4)',
          format: 'aac',
          dynaudnorm: true
        },
        {
          icon: mp3Icon,
          text: 'MP3',
          format: 'mp3',
          dynaudnorm: true,
          hidden: !info.features.mp3
        }
      ]
    },
    {
      title: 'Local processing',
      icon: computerIcon,
      buttons: [
        {
          icon: windowsIcon,
          text: 'Windows Application',
          format: 'powersfx',
          container: 'exe',
          hidden: !platform.windows && !platform.showHidden
        },
        {
          icon: macIcon,
          text: 'Mac OS X Application',
          format: 'powersfxm',
          hidden: (!platform.macosx || platform.iphone) && !platform.showHidden
        },
        {
          icon: unixIcon,
          text: 'Unix Script',
          format: 'powersfxu',
          hidden: (!platform.unix || platform.android) && !platform.showHidden
        }
      ]
    },
    {
      title: 'Miscellaneous (unsupported)',
      buttons: [
        {
          icon: rawIcon,
          text: 'Raw',
          format: 'raw'
        }
      ]
    }
  ];

  return sections.filter(section => section.buttons.some(button => !button.hidden));
};

