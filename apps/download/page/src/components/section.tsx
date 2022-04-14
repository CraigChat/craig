import { Icon, IconifyIcon } from '@iconify/react';
import arrowDown from '@iconify-icons/ic/baseline-arrow-drop-down';
import arrowUp from '@iconify-icons/ic/baseline-arrow-drop-up';
import clsx from 'clsx';
import { h } from 'preact';
import { useState } from 'preact/hooks';

interface SectionProps {
  icon?: IconifyIcon;
  title: string;
  small?: boolean;
  collapsable?: boolean;
  collapsed?: boolean;
  children?: any;
}

export default function Section({ icon, title, small, collapsable, collapsed, children }: SectionProps) {
  const [isCollapsed, setCollapsed] = useState(collapsed || false);
  const OuterHeading = collapsable ? 'button' : 'div';
  const Heading = small ? 'h4' : 'h2';
  const iconClass = small ? 'w-6 h-6' : 'w-8 h-8';

  return (
    <div class={clsx('flex flex-col', small ? 'gap-2' : 'gap-4')}>
      <OuterHeading
        class={clsx(
          'font-display flex flex-row gap-2 items-center transition-colors outline-none',
          small ? 'text-lg font-medium' : 'text-2xl font-bold',
          {
            'text-zinc-400': isCollapsed && !small,
            'text-zinc-500': isCollapsed && small,
            'text-zinc-100': !isCollapsed && !small,
            'text-zinc-300': !isCollapsed && small,
            'focus:text-zinc-300': collapsable && !small,
            'focus:text-zinc-400': collapsable && small
          }
        )}
        onClick={collapsable ? () => setCollapsed(!isCollapsed) : null}
      >
        {collapsable ? <Icon icon={isCollapsed ? arrowDown : arrowUp} className={iconClass} /> : ''}
        {icon ? <Icon icon={icon} className={iconClass} /> : ''}
        <Heading>{title}</Heading>
      </OuterHeading>
      {!isCollapsed ? children : ''}
    </div>
  );
}
