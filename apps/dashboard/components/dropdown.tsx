import { Fragment, useState } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import clsx from 'clsx';

export interface DropdownItem extends Record<string, any> {
  title: string;
  suffix?: string;
  value: string;
}

interface DropdownProps {
  className?: string;
  label?: string;
  items: DropdownItem[];
  selected?: DropdownItem;
  full?: boolean;
  right?: boolean;
  bottom?: boolean;
  disabled?: boolean;
  onSelect?(item: DropdownItem): any;
}

export default function Dropdown({
  className,
  label,
  items,
  selected: defaultSelected,
  full,
  right,
  bottom,
  disabled,
  onSelect
}: DropdownProps) {
  const [selected, setSelected] = useState(defaultSelected || items[0]);

  function onSelectItem(item: DropdownItem) {
    if (onSelect) onSelect(item);
    setSelected(item);
  }

  return (
    <Listbox value={selected} onChange={onSelectItem} disabled={disabled}>
      {({ open }) => (
        <div className={clsx('flex flex-col gap-1', className)}>
          {label ? (
            <Listbox.Label className="block text-sm font-medium font-display text-zinc-400">{label}</Listbox.Label>
          ) : (
            ''
          )}
          <div className={clsx(label ? 'mt-1' : '', 'mt-1 relative')}>
            <Listbox.Button
              className={clsx(
                'relative text-sm sm:text-base bg-zinc-600 rounded-md pl-3 pr-12 py-2 text-left cursor-default shadow-md focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500',
                {
                  'opacity-75': disabled,
                  'w-full': full
                }
              )}
            >
              <span className="flex items-center gap-1">
                {selected.icon ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    xmlnsXlink="http://www.w3.org/1999/xlink"
                    aria-hidden="true"
                    role="img"
                    className="h-5 w-5"
                    width="1em"
                    height="1em"
                    preserveAspectRatio="xMidYMid meet"
                    viewBox="0 0 24 24"
                  >
                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41z" />
                  </svg>
                ) : (
                  ''
                )}
                <span className="block truncate font-medium">
                  {selected.title}
                  {selected.suffix ? <span className="font-normal"> {selected.suffix}</span> : ''}
                </span>
              </span>
              <span className="ml-3 absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  xmlnsXlink="http://www.w3.org/1999/xlink"
                  aria-hidden="true"
                  role="img"
                  className="h-5 w-5 text-gray-400"
                  width="1em"
                  height="1em"
                  preserveAspectRatio="xMidYMid meet"
                  viewBox="0 0 24 24"
                >
                  <path fill="currentColor" d="m7 10l5 5l5-5z" />
                </svg>
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
                {items.map((item) => (
                  <Listbox.Option
                    key={item.value}
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
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              xmlnsXlink="http://www.w3.org/1999/xlink"
                              aria-hidden="true"
                              role="img"
                              className="h-5 w-5"
                              width="1em"
                              height="1em"
                              preserveAspectRatio="xMidYMid meet"
                              viewBox="0 0 24 24"
                            >
                              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41z" />
                            </svg>
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
