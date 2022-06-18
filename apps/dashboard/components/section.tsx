import clsx from 'clsx';

interface SectionProps {
  children?: any;
  title?: string;
  big?: boolean;
}

export default function Section({ title, children, big }: SectionProps) {
  return (
    <div className="flex flex-col w-full">
      <h5
        className={clsx('block font-display mb-2', {
          'text-sm font-medium text-zinc-400': !big,
          'text-xl font-bold text-white mt-2': big
        })}
      >
        {title}
      </h5>
      <div className="flex flex-col justify-center items-center gap-4">{children}</div>
    </div>
  );
}
