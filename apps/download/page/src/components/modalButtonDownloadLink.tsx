import clsx from 'clsx';
import { h } from 'preact';

interface ModalButtonDownloadLinkProps {
  children?: any;
  type?: 'brand' | 'danger' | 'transparent';
  file: string;
  href: string;
  disabled?: boolean;
}

export default function ModalButtonDownloadLink({ children, type, href, file, disabled }: ModalButtonDownloadLinkProps) {
  return (
    <a
      href={href}
      download={file}
      disabled={disabled}
      class={clsx('px-4 py-2 rounded-md transition-colors focus:ring-2 outline-none', {
        'bg-zinc-600 hover:bg-zinc-500 focus:ring-zinc-300': !type,
        'bg-teal-600 hover:bg-teal-500 focus:ring-teal-300': type === 'brand',
        'bg-red-600 hover:bg-red-500 focus:ring-red-300': type === 'danger',
        'hover:underline focus:underline': type === 'transparent',
        'bg-opacity-50 cursor-not-allowed': disabled
      })}
    >
      {children}
    </a>
  );
}
