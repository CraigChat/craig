interface LinkButtonProps {
  name: any;
  href: string;
}

export default function LinkButton({ name, href }: LinkButtonProps) {
  return (
    <a className="text-zinc-400 font-medium hover:text-zinc-200 focus:text-zinc-200 outline-none active:underline" href={href}>
      {name}
    </a>
  );
}
