interface SectionProps {
  children?: any;
  title?: string;
}

export default function Section({ title, children }: SectionProps) {
  return (
    <div className="flex flex-col w-full">
      <h5 className="block text-sm font-medium font-display text-zinc-400 mb-2">{title}</h5>
      <div className="flex flex-col justify-center items-center gap-4">{children}</div>
    </div>
  );
}
