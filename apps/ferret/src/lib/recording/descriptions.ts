import type { Translatable } from '$lib/util';

interface ZipContentFile {
  name: string;
  folder?: boolean;
  runnable?: boolean;
}

export interface Description {
  file: string;
  zipContents?: ZipContentFile[];
  title?: Translatable;
  description?: Translatable;
}

export const descriptions: Record<string, Description> = {
  '-:aupzip': {
    file: '.aup.zip',
    zipContents: [
      {
        name: '{id}_data',
        folder: true
      },
      {
        name: '{id}.aup',
        runnable: true
      },
      {
        name: 'info.txt'
      },
      {
        name: 'raw.dat'
      }
    ],
    description: { t: 'download.modal.description.project', values: { software: 'Audacity', file: '.aup' } }
  },
  '-:sesxzip': {
    file: '.sesx.zip',
    zipContents: [
      {
        name: '{id}_data',
        folder: true
      },
      {
        name: '{id}.sesx',
        runnable: true
      },
      {
        name: 'info.txt'
      },
      {
        name: 'raw.dat'
      }
    ],
    description: { t: 'download.modal.description.project', values: { software: 'Adobe Audition', file: '.sesx' } }
  },
  'powersfx:exe': {
    file: '.exe',
    description: { t: 'download.modal.description.executable' }
  },
  'powersfxm:-': {
    file: '.powersfxm.zip',
    zipContents: [
      {
        name: '{user}.flac'
      },
      {
        name: '...'
      },
      {
        name: 'ffmpeg'
      },
      {
        name: 'RunMe.command',
        runnable: true
      },
      {
        name: 'info.txt'
      },
      {
        name: 'raw.dat'
      }
    ],
    description: { t: 'download.modal.description.script' }
  },
  'powersfxu:-': {
    file: '.powersfxu.zip',
    zipContents: [
      {
        name: '{user}.flac'
      },
      {
        name: '...'
      },
      {
        name: 'RunMe.sh',
        runnable: true
      },
      {
        name: 'info.txt'
      },
      {
        name: 'raw.dat'
      }
    ],
    description: { t: 'download.modal.description.linux_script' }
  },
  '/raw.dat': {
    file: '-raw.dat',
    description: { t: 'download.modal.description.raw' }
  },
  '/info.txt': {
    file: '-info.txt',
    description: { t: 'download.modal.description.infotxt' }
  }
};
