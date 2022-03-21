import { Dialog } from '@headlessui/react';

interface ModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  title?: string;
  children?: any;
}

export function Modal({ open, setOpen, title, children }: ModalProps) {
  // Prevent dumb TS errors
  const DialogFix = Dialog as any;
  const Title = Dialog.Title as any;
  const Description = Dialog.Description as any;

  return (
    <DialogFix
      as="div"
      open={open}
      className="fixed inset-0 z-10 overflow-y-auto bg-black bg-opacity-50"
      onClose={() => setOpen(false)}
    >
      <div className="min-h-screen px-4 text-center">
        <Dialog.Overlay className="fixed inset-0" />

        <div className="min-h-screen px-4 flex flex-col justify-center items-center">
          <div className="inline-block w-full max-w-lg p-6 overflow-hidden text-left align-middle transition-all transform bg-zinc-600 shadow-xl rounded-2xl">
            <Title as="h3" className="text-lg font-medium leading-6 text-white">
              {title}
            </Title>
            <Description className="mt-2 text-zinc-200">{children}</Description>
          </div>
        </div>
      </div>
    </DialogFix>
  );
}
