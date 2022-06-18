import clsx from 'clsx';

interface ButtonProps {
  onClick?(): any;
  disabled?: boolean;
}

export default function GoogleButton({ onClick, disabled }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx('shadow flex items-center justify-center font-roboto transition-colors py-2 px-4 gap-4', {
        'text-neutral-500 bg-white rounded active:bg-neutral-200 hover:ring-2 focus:outline-none': !disabled,
        'bg-black bg-opacity-10 text-black text-opacity-50': disabled
      })}
    >
      <svg
        className={clsx('w-6 h-6', { 'opacity-50': disabled })}
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
        viewBox="0 0 48 48"
      >
        <defs>
          <path
            id="a"
            d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"
          />
        </defs>
        <clipPath id="b">
          <use xlinkHref="#a" overflow="visible" />
        </clipPath>
        <path className={clsx({ 'fill-black': disabled })} clipPath="url(#b)" fill="#FBBC05" d="M0 37V11l17 13z" />
        <path className={clsx({ 'fill-black': disabled })} clipPath="url(#b)" fill="#EA4335" d="M0 11l17 13 7-6.1L48 14V0H0z" />
        <path className={clsx({ 'fill-black': disabled })} clipPath="url(#b)" fill="#34A853" d="M0 37l30-23 7.9 1L48 0v48H0z" />
        <path className={clsx({ 'fill-black': disabled })} clipPath="url(#b)" fill="#4285F4" d="M48 48L17 24l-4-3 35-10z" />
      </svg>
      <span className="font-semibold">Sign in with Google</span>
    </button>
  );
}
