import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import { Listbox, Transition } from '@headlessui/react';
import { Icon, IconifyIcon } from '@iconify/react';
import checkIcon from '@iconify-icons/ic/baseline-check';
import dropdownIcon from '@iconify-icons/ic/baseline-arrow-drop-down';
import clsx from 'clsx';

interface DropdownItem extends Record<string, any> {
  icon?: IconifyIcon;
  title: string;
  suffix?: string;
}

interface DropdownProps {
  label?: string;
  items: DropdownItem[];
  selected?: DropdownItem;
  full?: boolean;
  right?: boolean;
  bottom?: boolean;
  onSelect?(item: DropdownItem): any;
}

export default function Dropdown({
  label,
  items,
  selected: defaultSelected,
  full,
  right,
  bottom,
  onSelect
}: DropdownProps) {
  const [selected, setSelected] = useState(defaultSelected || items[0]);

  function onSelectItem(item: DropdownItem) {
    if (onSelect) onSelect(item);
    setSelected(item);
  }

  return (
    <Listbox value={selected} onChange={onSelectItem}>
      {({ open }) => (
        <div className="flex flex-col gap-1">
          {label ? <Listbox.Label className="block text-sm font-medium text-zinc-400">{label}</Listbox.Label> : ''}
          <div className="mt-1 relative">
            <Listbox.Button className="relative text-sm sm:text-base w-full bg-zinc-600 rounded-md shadow-sm pl-3 pr-12 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500">
              <span className="flex items-center gap-1">
                {selected.icon ? <Icon icon={selected.icon} className="w-5 h-5 pointer-events-none" /> : ''}
                <span className="block truncate font-medium">
                  {selected.title}
                  {selected.suffix ? <span className="font-normal"> {selected.suffix}</span> : ''}
                </span>
              </span>
              <span className="ml-3 absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <Icon icon={dropdownIcon} className="h-5 w-5 text-gray-400" aria-hidden="true" />
              </span>
            </Listbox.Button>

            <Transition
              show={open}
              // @ts-ignore
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options
                className={clsx(
                  full ? 'w-full' : '',
                  right ? 'right-0' : '',
                  bottom ? 'bottom-full' : '',
                  'absolute z-10 my-1 bg-zinc-700 shadow-lg max-h-56 rounded-md text-sm sm:text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none'
                )}
              >
                {items.map((item, i) => (
                  <Listbox.Option
                    key={i}
                    className={({ active }) =>
                      clsx(
                        active ? 'text-white bg-teal-600' : '',
                        'cursor-default select-none relative py-2 pl-3 pr-12'
                      )
                    }
                    value={item}
                  >
                    {({ selected, active }) => (
                      <Fragment>
                        <div className="flex items-center gap-1 text-sm sm:text-base">
                          {item.icon ? <Icon icon={item.icon} className="w-5 h-5 pointer-events-none" /> : ''}
                          <span className="block truncate font-medium">
                            {item.title}
                            {item.suffix ? <span className="font-normal"> {item.suffix}</span> : ''}
                          </span>
                        </div>

                        {selected ? (
                          <span
                            className={clsx(
                              active ? 'text-white' : 'text-teal-600',
                              'absolute inset-y-0 right-0 flex items-center pr-4'
                            )}
                          >
                            <Icon icon={checkIcon} className="h-5 w-5" aria-hidden="true" />
                          </span>
                        ) : null}
                      </Fragment>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </div>
      )}
    </Listbox>
  );
}
