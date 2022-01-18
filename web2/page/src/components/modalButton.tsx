import clsx from 'clsx';
import { h } from 'preact';

interface ModalButtonProps {
  children?: any;
  type?: 'brand' | 'danger';
  onClick?(e: MouseEvent): any;
  disabled?: boolean;
}

export default function ModalButton({ children, type, onClick, disabled }: ModalButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled} class={clsx(
      'px-4 py-2 rounded-md transition-colors focus:ring-2 outline-none',
      {
        'bg-zinc-600 hover:bg-zinc-500 focus:ring-zinc-300': !type,
        'bg-teal-600 hover:bg-teal-500 focus:ring-teal-300': type === 'brand',
        'bg-red-600 hover:bg-red-500 focus:ring-red-300': type === 'danger',
        'bg-opacity-50 cursor-not-allowed pointer-events-none': disabled
      }
    )}>
      {children}
    </button>
  )
}
