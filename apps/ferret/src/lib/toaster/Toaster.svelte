<script lang="ts">
  import './styles.css';

  import { onDestroy, onMount } from 'svelte';

  import { ToastState } from './state.js';
  import Toast from './Toast.svelte';
  import type { HeightT, Position, ToastT, ToastToDismiss } from './types.js';

  // Visible toasts amount
  const VISIBLE_TOASTS_AMOUNT = 3;

  // Viewport padding
  const VIEWPORT_OFFSET = '32px';

  // Default toast width
  const TOAST_WIDTH = 356;

  // Default gap between toasts
  const GAP = 14;

  interface ToastOptions {
    class?: string;
    descriptionClass?: string;
    style?: string;
  }

  // function getInitialTheme(t: string) {
  //   if (t !== 'system') {
  //     return t;
  //   }

  //   if (typeof window !== 'undefined') {
  //     if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  //       return 'dark';
  //     }

  //     return 'light';
  //   }

  //   return 'light';
  // }

  interface Props {
    invert?: boolean;
    theme?: 'light' | 'dark' | 'system';
    position?: Position;
    hotkey?: string[];
    richColors?: boolean;
    expand?: boolean;
    duration?: number | null;
    visibleToasts?: number;
    closeButton?: boolean;
    toastOptions?: ToastOptions;
    offset?: string | number | null;
    class?: string;
    style?: string;
  }

  let {
    invert = false,
    theme = 'light',
    position = 'bottom-right',
    hotkey = ['altKey', 'KeyT'],
    richColors = false,
    expand = false,
    duration = null,
    visibleToasts = VISIBLE_TOASTS_AMOUNT,
    closeButton = false,
    toastOptions = {},
    offset = null,
    class: _class,
    style
  }: Props = $props();

  let toasts: ToastT[] = $state([]);
  let heights: HeightT[] = $state([]);
  let expanded = $state(false);
  let interacting = $state(false);
  // let actualTheme = $state(getInitialTheme(theme));
  let coords = $derived(position.split('-'));
  let listRef: HTMLOListElement | undefined = $state();
  let hotkeyLabel = $derived(hotkey.join('+').replace(/Key/g, '').replace(/Digit/g, ''));
  let lastFocusedElementRef: HTMLElement | null = null;
  let isFocusWithinRef = false;

  onMount(() => {
    return ToastState.subscribe((toast) => {
      if ((toast as ToastToDismiss).dismiss) {
        toasts = toasts.map((t) => (t.id === toast.id ? { ...t, delete: true } : t));
        return;
      }

      const indexOfExistingToast = toasts.findIndex((t) => t.id === toast.id);

      if (indexOfExistingToast !== -1) {
        toasts = [...toasts.slice(0, indexOfExistingToast), { ...toasts[indexOfExistingToast], ...toast }, ...toasts.slice(indexOfExistingToast + 1)];
      } else {
        toasts = [toast as any, ...toasts];
      }
    });
  });

  $effect(() => {
    if (toasts.length <= 1) expanded = false;
  });

  onDestroy(() => {
    if (listRef && lastFocusedElementRef) {
      lastFocusedElementRef.focus({ preventScroll: true });
      lastFocusedElementRef = null;
      isFocusWithinRef = false;
    }
  });

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const isHotkeyPressed = hotkey.every((key) => (event as any)[key] || event.code === key);

      if (isHotkeyPressed) {
        expanded = true;
        listRef?.focus();
      }

      if (event.code === 'Escape' && (document.activeElement === listRef || listRef?.contains(document.activeElement))) {
        expanded = false;
      }
    };

    document.addEventListener('keydown', handleKeydown);

    // window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ({ matches }) => {
    //   actualTheme = matches ? 'dark' : 'light';
    // });

    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  });

  function removeToast(event: CustomEvent<ToastT>) {
    toasts = toasts.filter(({ id }) => id !== event.detail.id);
  }

  function setHeights(event: CustomEvent<HeightT[]>) {
    heights = event.detail;
  }

  function handleBlur(
    event: FocusEvent & {
      currentTarget: EventTarget & HTMLOListElement;
    }
  ) {
    if (isFocusWithinRef && !event.currentTarget.contains(event.relatedTarget as HTMLElement)) {
      isFocusWithinRef = false;
      if (lastFocusedElementRef) {
        lastFocusedElementRef.focus({ preventScroll: true });
        lastFocusedElementRef = null;
      }
    }
  }

  function handleFocus(
    event: FocusEvent & {
      currentTarget: EventTarget & HTMLOListElement;
    }
  ) {
    if (!isFocusWithinRef) {
      isFocusWithinRef = true;
      lastFocusedElementRef = event.relatedTarget as HTMLElement;
    }
  }
</script>

{#if toasts.length > 0}
  <section aria-label={`Notifications ${hotkeyLabel}`} tabIndex={-1}>
    <ol
      tabIndex={-1}
      bind:this={listRef}
      class={_class}
      data-sonner-toaster
      data-theme={theme}
      data-rich-colors={richColors}
      data-y-position={coords[0]}
      data-x-position={coords[1]}
      onblur={handleBlur}
      onfocus={handleFocus}
      onmouseenter={() => (expanded = true)}
      onmousemove={() => (expanded = true)}
      onmouseleave={() => {
        if (!interacting) {
          expanded = false;
        }
      }}
      onpointerdown={() => (interacting = true)}
      onpointerup={() => (interacting = false)}
      style:--front-toast-height={`${heights[0]?.height}px`}
      style:--offset={typeof offset === 'number' ? `${offset}px` : offset || VIEWPORT_OFFSET}
      style:--width={`${TOAST_WIDTH}px`}
      style:--gap={`${GAP}px`}
      {style}
    >
      {#each toasts as toast, index (toast.id)}
        <Toast
          {index}
          {toast}
          {duration}
          class={toastOptions?.class}
          descriptionClass={toastOptions?.descriptionClass}
          invert={Boolean(invert)}
          {visibleToasts}
          closeButton={Boolean(closeButton)}
          {interacting}
          {position}
          style={toastOptions?.style ?? ''}
          on:removeToast={removeToast}
          {toasts}
          {heights}
          on:setHeights={setHeights}
          expandByDefault={Boolean(expand)}
          {expanded}
        />
      {/each}
    </ol>
  </section>
{/if}
