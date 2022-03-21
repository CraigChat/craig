import { Switch } from '@headlessui/react';
import { useState } from 'react';
import clsx from 'clsx';
import { Tooltip } from 'react-tippy';

interface ToggleProps {
  label: string;
  description?: string;
  checked?: boolean;
  alignSwitchUp?: boolean;
  className?: string;
  disabled?: boolean;
  tooltip?: string;
  onToggle?(checked: boolean): any;
}

export default function Toggle({
  label,
  description,
  checked,
  disabled,
  tooltip,
  className,
  alignSwitchUp,
  onToggle
}: ToggleProps) {
  const [enabled, setEnabled] = useState(checked || false);

  function onSwitch(checked: boolean) {
    if (onToggle) onToggle(checked);
    setEnabled(checked);
  }

  return (
    <Switch.Group>
      <div className={clsx('flex items-center justify-between', className)}>
        <div className="flex flex-col gap-1">
          <Switch.Label className="font-display" passive>
            {label}
          </Switch.Label>
          {description ? <Switch.Description className="text-sm opacity-50">{description}</Switch.Description> : ''}
        </div>

        <Tooltip disabled={!tooltip} title={tooltip}>
          <Switch
            checked={enabled}
            onChange={onSwitch}
            disabled={disabled}
            className={clsx(
              alignSwitchUp ? 'self-start' : '',
              enabled ? 'bg-teal-600' : 'bg-zinc-400',
              disabled ? 'opacity-50' : '',
              'flex-none ml-4 relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500'
            )}
          >
            <span
              className={clsx(
                enabled ? 'translate-x-6' : 'translate-x-1',
                'inline-block w-4 h-4 transform bg-white rounded-full transition-transform'
              )}
            />
          </Switch>
        </Tooltip>
      </div>
    </Switch.Group>
  );
}
