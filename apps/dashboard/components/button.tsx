import clsx from 'clsx';

interface ButtonProps {
  children?: any;
  type?: 'brand' | 'danger' | 'transparent';
  onClick?(): any;
  disabled?: boolean;
  className?: string;
}

export default function Button({ children, type, onClick, disabled, className }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'px-4 py-2 rounded-md transition-colors focus:ring-2 outline-none font-body font-medium text-white',
        className,
        {
          'bg-zinc-700': !type,
          'bg-teal-600': type === 'brand',
          'bg-red-600': type === 'danger',
          'hover:bg-zinc-500 focus:ring-zinc-300': !type && !disabled,
          'hover:bg-teal-500 focus:ring-teal-300': type === 'brand' && !disabled,
          'hover:bg-red-500 focus:ring-red-300': type === 'danger' && !disabled,
          'hover:underline focus:underline': type === 'transparent' && !disabled,
          'bg-opacity-50 cursor-not-allowed text-zinc-400': disabled
        }
      )}
    >
      {children}
    </button>
  );
}
