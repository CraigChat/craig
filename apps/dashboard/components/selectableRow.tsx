import clsx from 'clsx';

interface SelectableRowProps {
  children?: any;
  title?: string;
  icon?: any;
  selected?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick?(): any;
}

export default function SelectableRow({ title, children, icon, selected, disabled, hidden, onClick }: SelectableRowProps) {
  return (
    <div className="flex justify-between bg-zinc-600 rounded-md px-3 py-2 shadow-md w-full">
      <div className="flex group justify-center items-center gap-2 font-medium select-none" onClick={!disabled ? onClick : undefined}>
        {!hidden && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={clsx('w-6 h-6 rounded-full transition-colors', {
              'bg-teal-600': selected && !disabled,
              'bg-zinc-800': !selected && !disabled,
              'cursor-pointer': !disabled,
              'bg-zinc-700 cursor-not-allowed': disabled
            })}
          >
            <circle
              className={clsx(!selected && !disabled && 'transition-colors fill-transparent group-hover:fill-zinc-500')}
              cx={12}
              cy={12}
              r={6}
            />
            <path className={clsx(selected && 'stroke-white')} d="M7 13l3 3 7-7" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex justify-center items-center gap-2">{children}</div>
    </div>
  );
}
