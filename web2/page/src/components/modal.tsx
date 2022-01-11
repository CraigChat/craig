import clsx from 'clsx';
import { h } from 'preact';
import ReactModal from 'react-modal';

interface ModalProps {
  open: boolean;
  label?: string;
  children?: any;
  onClose?(event: any): any;
}

export default function Modal({ open, label, children, onClose }: ModalProps) {
  return (
    <ReactModal
      isOpen={open}
      onRequestClose={onClose}
      ariaHideApp={false}
      contentLabel={label || 'Modal'}
      portalClassName={clsx('fixed inset-0', { 'pointer-events-none': !open })}
      overlayClassName="h-screen flex justify-center items-center bg-black bg-opacity-25"
      className="p-6 bg-zinc-700 text-white outline-none rounded min-w-1/2 w-5/6 md:min-w-2/5"
    >
      {children}
    </ReactModal>
  )
}
