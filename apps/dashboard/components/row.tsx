interface RowProps {
  children?: any;
  title?: string;
  icon?: any;
}

export default function Row({ title, children, icon }: RowProps) {
  return (
    <div className="flex justify-between bg-zinc-600 rounded-md px-3 py-2 shadow-md w-full">
      <div className="flex justify-center items-center gap-2 font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex justify-center items-center gap-2">{children}</div>
    </div>
  );
}
