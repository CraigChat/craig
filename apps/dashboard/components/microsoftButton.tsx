interface ButtonProps {
  onClick?(): any;
}

export default function MicrosoftButton({ onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className="shadow flex items-center justify-center font-roboto transition-colors py-2 px-4 gap-4 text-neutral-500 bg-white rounded active:bg-neutral-200 hover:ring-2 focus:outline-none"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20">
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
      <span className="font-semibold">Sign in with Microsoft</span>
    </button>
  );
}
