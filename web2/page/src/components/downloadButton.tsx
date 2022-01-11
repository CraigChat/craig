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
        'flex flex-row p-2 px-4 gap-2 items-center justify-center min-w-button font-medium border-2 bg-opacity-25 rounded-md hover:text-white hover:bg-opacity-100 transition-colors',
        {
          'border-teal-400 bg-teal-400 text-teal-400': !ennuizel,
          'border-red-400 bg-red-400 text-red-400': ennuizel
        }
      )}
      onClick={onClick}
    >
      {icon ? <Icon icon={icon} className="w-5 h-5" /> : ''}
      <span>{title}{suffix ? (
        <span class="font-normal"> {suffix}</span>
      ) : ''}</span>
    </button>
  )
}
