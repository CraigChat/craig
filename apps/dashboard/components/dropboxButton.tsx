interface ButtonProps {
  onClick?(): any;
}

export default function DropboxButton({ onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className="shadow flex items-center justify-center font-roboto transition-colors py-2 px-4 gap-4 text-neutral-500 bg-white rounded active:bg-neutral-200 hover:ring-2 focus:outline-none"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 256 218">
        <path fill="#0061FF" d="M63.995 0L0 40.771l63.995 40.772L128 40.771zM192 0l-64 40.775l64 40.775l64.001-40.775zM0 122.321l63.995 40.772L128 122.321L63.995 81.55zM192 81.55l-64 40.775l64 40.774l64-40.774zM64 176.771l64.005 40.772L192 176.771L128.005 136z"/>
      </svg>
      <span className="font-semibold">Sign in with Dropbox</span>
    </button>
  );
}
