import { h } from 'preact';

interface ModalContentProps {
  title?: string;
  children?: any;
  buttons?: any[];
}

export default function ModalContent({ title, children, buttons }: ModalContentProps) {
  return (
    <div class="flex flex-col">
      {title ? <h1 class="font-display text-2xl">{title}</h1> : ''}
      <div>{children}</div>
      {buttons ? (
        <div class="flex gap-2 mt-4 items-center">
          {buttons}
        </div>
      ) : ''}
    </div>
  )
}
