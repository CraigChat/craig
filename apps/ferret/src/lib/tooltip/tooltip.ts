import {
  arrow as floatingArrow,
  autoUpdate,
  computePosition,
  flip as floatingFlip,
  offset as floatingOffset,
  shift as floatingShift
} from '@floating-ui/dom';

import { DEFAULTS as D } from './defaults.js';
import type { Options } from './types.js';
import { animate, ID, wait } from './utils.js';

export default (node: HTMLElement, options: Options) => {
  let { html = D.html }: Options = options;
  const {
    content,
    target = D.target,
    placement = D.placement,
    shiftPadding = D.shiftPadding,
    offset = D.offset,
    delay = D.delay,
    constant = D.constant,
    classes = D.classes,
    middleware = D.middleware,
    visibility = D.visibility,
    onMount,
    onDestroy
  }: Options = options;

  let _visibility: boolean = visibility;

  if (!content) return;

  const targetEl = typeof target === 'string' ? document.querySelector(target) : target;
  const _delay = {
    in: typeof delay === 'number' ? delay : delay[0],
    out: typeof delay === 'number' ? delay : delay[1]
  };
  const id = `svooltip-${ID()}`;

  let _content = node.title || content!;
  node.removeAttribute('title');

  let TIP: HTMLElement | null;
  let TIPContent: HTMLElement | null;
  let TIPArrow: HTMLElement;

  let hovering = false;
  let visible = false;

  let currentDelay: ReturnType<typeof setTimeout> | undefined;

  let wasDestroyed = false;

  const handleKeys = ({ key }: KeyboardEvent) => {
    if (key === 'Escape' || key === 'Esc') hide();
  };

  let cleanup: () => void | null;

  const create = () => {
    if (TIP || visible) return;

    // Tooltip
    TIP = document.createElement('div');
    TIP.setAttribute('id', id);
    TIP.setAttribute('role', 'tooltip');
    TIP.setAttribute('data-placement', placement);
    TIP.setAttribute('class', classes.container!);

    // Content
    TIPContent = document.createElement('span');
    TIPContent.setAttribute('class', classes.content!);
    TIPContent[html ? 'innerHTML' : 'textContent'] = _content;

    // Arrow
    TIPArrow = document.createElement('div');
    TIPArrow.setAttribute('class', classes.arrow!);

    // Append
    TIP.append(TIPArrow);
    TIP.append(TIPContent);
  };
  const position = () => {
    if (!TIP || !TIPArrow) return;

    computePosition(node, TIP, {
      placement,
      middleware: [
        floatingOffset(offset),
        floatingFlip(),
        floatingShift({ padding: shiftPadding }),
        floatingArrow({ element: TIPArrow }),
        ...middleware
      ]
    }).then(({ x, y, placement, middlewareData }) => {
      TIP!.style.left = `${x}px`;
      TIP!.style.top = `${y}px`;

      const { x: arrowX, y: arrowY } = middlewareData.arrow!;

      const side = {
        top: 'bottom',
        right: 'left',
        bottom: 'top',
        left: 'right'
      }[placement.split('-')[0]]!;

      const arrowSize = (TIPArrow.getBoundingClientRect().width / 3).toFixed();

      Object.assign(TIPArrow.style, {
        left: arrowX != null ? `${arrowX}px` : '',
        top: arrowY != null ? `${arrowY}px` : '',
        right: '',
        bottom: '',
        [side]: `-${arrowSize}px`
      });
    });
  };

  const show = async () => {
    if (!TIP && _visibility) {
      if (_delay.in > 0) {
        await wait(_delay.in, currentDelay);
        if (wasDestroyed || !hovering || visible || TIP) return;
      }

      node.setAttribute('aria-describedby', id);

      create();
      position();

      if (cleanup) cleanup();
      cleanup = autoUpdate(node, TIP!, position);

      if (!targetEl) throw new Error(`[SVooltip] Cannot find \`${targetEl}\``);
      if (!TIP) throw new Error(`[SVooltip] Tooltip has not been created.`);

      targetEl.append(TIP);

      await animate(classes.animationEnter!, classes.animationLeave!, TIP);

      onMount?.();
      visible = true;
    }
  };

  const hide = async () => {
    if (TIP || visible) {
      if (_delay.out > 0) {
        await wait(_delay.out, currentDelay);
      }

      await animate(classes.animationLeave!, classes.animationEnter!, TIP);

      if (cleanup) cleanup();

      if (TIP) {
        node.removeAttribute('aria-describedby');
        visible = false;
        TIP.remove();
        TIP = null;

        onDestroy?.();
      }
    }
  };

  if (constant) {
    show();
  } else {
    node.addEventListener('mouseenter', show);
    node.addEventListener('mouseenter', () => (hovering = true));
    node.addEventListener('focus', show);

    node.addEventListener('mouseleave', hide);
    node.addEventListener('mouseleave', () => (hovering = false));
    node.addEventListener('blur', hide);

    window.addEventListener('keydown', handleKeys);

    return {
      update(props: Options) {
        _content = props.content;
        html = props.html || false;
        _visibility = props.visibility ?? visibility;

        if ((TIP || visible) && !_visibility) hide();
        else if (!TIP && !visible && _visibility && node === document.activeElement) show();
        else if (TIP && TIPContent) {
          TIPContent[html ? 'innerHTML' : 'textContent'] = _content;
          position();
        }
      },
      destroy() {
        if (TIP) {
          node.removeAttribute('aria-describedby');
          visible = false;
          TIP.remove();
          TIP = null;
        }
        window.removeEventListener('keydown', handleKeys);

        onDestroy?.();
        wasDestroyed = true;
      }
    };
  }
};
