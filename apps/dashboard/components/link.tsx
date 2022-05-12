interface LinkProps {
  href: string;
  children?: any;
  [key: string]: any;
}

export default function Link({ href, children, ...props }: LinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-teal-500 outline-teal-300/50 outline-offset-2 outline-2 rounded focus:outline hover:underline"
      {...props}
    >
      {children}
    </a>
  );
}
