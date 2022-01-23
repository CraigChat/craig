import { useState } from 'preact/hooks';
import { createRef, h } from 'preact';
import { ChromePicker } from 'react-color';
import clsx from 'clsx';
import { FocusTrap } from '@headlessui/react';

interface ColorPickerProps {
  label?: string;
  color?: string;
  className?: string;
  full?: boolean;
  onChange?(color: string): any;
}

export default function ColorPicker({ label, color: defaultColor, onChange, className, full }: ColorPickerProps) {
  const [color, setColor] = useState(defaultColor || '#000000');
  const [showPicker, setShowPicker] = useState(false);
  const buttonRef = createRef();

  function onCoverClick() {
    setShowPicker(false);
    buttonRef.current.focus();
  }

  function onSwitchChange(newColor: any) {
    if (onChange) onChange(newColor.hex);
    setColor(newColor.hex);
  }

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label ? <label className="block text-sm font-medium font-display text-zinc-400">{label}</label> : ''}
      <div className={clsx(label ? 'mt-1' : '', 'mt-1 relative')}>
        <button
          ref={buttonRef}
          className={clsx(
            full ? 'w-full' : '',
            'flex items-center bg-zinc-600 p-2 gap-2 border border-black border-opacity-20 rounded-md py-2 px-3',
            'focus:outline-none focus:ring-1 focus:ring-teal-500'
          )}
          onClick={() => setShowPicker(!showPicker)}
        >
          <i class="w-4 h-4 rounded-full shadow-sm" style={{ 'background-color': color }} />
          <span class="font-mono">{color}</span>
        </button>

        {showPicker ? (
          // @ts-ignore
          <FocusTrap as="div" className="absolute bottom-full mb-1 z-10">
            <div class="fixed left-0 right-0 top-0 bottom-0" onClick={onCoverClick} />
            <ChromePicker disableAlpha color={color} onChangeComplete={onSwitchChange} />
          </FocusTrap>
        ) : (
          ''
        )}
      </div>
    </div>
  );
}
