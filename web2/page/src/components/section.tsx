import { Icon, IconifyIcon } from '@iconify/react';
import clsx from 'clsx';
import { h } from 'preact';
import { useState } from 'preact/hooks';
import arrowDown from '@iconify-icons/ic/baseline-arrow-drop-down';
import arrowUp from '@iconify-icons/ic/baseline-arrow-drop-up';

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
  const Heading = small ? 'h4' : 'h2';

  return (
    <div class={clsx("flex flex-col", small ? "gap-2" : "gap-4")}>
      <Heading
        class={clsx(
          "font-display flex flex-row gap-2",
          small ? "text-xl font-medium" : "text-2xl font-bold",
          {
            'text-zinc-400': isCollapsed && !small,
            'text-zinc-500': isCollapsed && small,
            'text-zinc-100': !isCollapsed && !small,
            'text-zinc-300': !isCollapsed && small,
            'cursor-pointer': collapsable
          }
        )}
        onClick={collapsable ? () => setCollapsed(!isCollapsed) : null}
      >
        {collapsable ? <Icon icon={isCollapsed ? arrowDown : arrowUp} /> : ''}
        {icon ? <Icon icon={icon} /> : ''}
        <span>{title}</span>
      </Heading>
      {isCollapsed ? children : ''}
    </div>
  )
}
