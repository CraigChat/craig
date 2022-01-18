import { Icon, IconifyIcon } from '@iconify/react';
import clsx from 'clsx';
import { h } from 'preact';

interface DownloadButtonProps {
  icon?: IconifyIcon;
  title: string;
  suffix?: string;
  ennuizel?: boolean;
  onClick?(event: MouseEvent): any;
}

export default function DownloadButton({ icon, title, suffix, ennuizel, onClick }: DownloadButtonProps) {
  return (
    <button
      class={clsx(
        'inline-flex flex-row text-sm sm:text-base p-2 sm:px-4 gap-2 items-center justify-center w-fit min-w-button font-medium border-2 bg-opacity-25 rounded-md',
        'hover:text-white hover:bg-opacity-100 transition-colors',
        'focus:text-white focus:bg-opacity-100 active:border-white outline-none',
        {
          'border-teal-400 bg-teal-400 text-teal-400': !ennuizel,
          'border-red-500 bg-red-500 text-red-500': ennuizel
        }
      )}
      onClick={onClick}
    >
      {icon ? <Icon icon={icon} className="w-5 h-5 pointer-events-none" /> : ''}
      <span class="pointer-events-none">{title}{suffix ? (
        <span class="font-normal"> {suffix}</span>
      ) : ''}</span>
    </button>
  )
}
