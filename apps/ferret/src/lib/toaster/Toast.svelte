<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import Icon from './Icon.svelte';
  import Loader from './Loader.svelte';
  import type { HeightT, Position, ToastT } from './types.js';

  // Default lifetime of a toasts (in ms)
  const TOAST_LIFETIME = 4000;

  // Default gap between toasts
  const GAP = 14;

  const SWIPE_TRESHOLD = 20;

  const TIME_BEFORE_UNMOUNT = 200;

  interface Props {
    toast: ToastT;
    toasts: ToastT[];
    index: number;
    expanded: boolean;
    invert: boolean;
    heights: HeightT[];
    position: Position;
    visibleToasts: number;
    expandByDefault: boolean;
    closeButton: boolean;
    interacting: boolean;
    duration: number | null;
    descriptionClass?: string;
    class?: string;
    style?: string;
    onSetHeights?: (heights: HeightT[]) => void;
    onRemoveToast?: (toast: ToastT) => void;
  }

  let {
    toast,
    toasts,
    index,
    expanded,
    invert: _invert = $bindable(),
    heights,
    position,
    visibleToasts,
    expandByDefault,
    closeButton,
    interacting,
    duration,
    descriptionClass = '',
    class: _class,
    style,
    onSetHeights,
    onRemoveToast
  }: Props = $props();

  let mounted = $state(false);
  let removed = $state(false);
  let swiping = $state(false);
  let swipeOut = $state(false);
  let offsetBeforeRemove = $state(0);
  let initialHeight = $state(0);
  let toastRef: HTMLLIElement | undefined = $state();

  let isFront = $derived(index === 0);
  let isVisible = $derived(index + 1 <= visibleToasts);
  let toastType = $derived(toast.type);
  let toastClass = $derived(toast.class || '');
  let toastDescriptionClass = $derived(toast.descriptionClass || '');

  // Height index is used to calculate the offset as it gets updated before the toast array, which means we can calculate the new layout faster.
  let heightIndex = $derived(heights.findIndex((height) => height.toastId === toast.id) || 0);
  let offset = $state(0);
  let closeTimerStartTimeRef = 0;
  let closeTimerRemainingTimeRef = toast.duration || duration || TOAST_LIFETIME;
  let lastCloseTimerStartTimeRef = 0;
  let pointerStartRef: { x: number; y: number } | null = null;
  let coords = $derived(position.split('-'));
  let toastsHeightBefore = $derived(
    heights.reduce((prev, curr, reducerIndex) => {
      // Calculate offset up untill current  toast
      if (reducerIndex >= heightIndex) return prev;

      return prev + curr.height;
    }, 0)
  );
  let invert = $derived(() => toast.invert || _invert);
  let disabled = $derived(toastType === 'loading');

  $effect(() => {
    offset = heightIndex * GAP + toastsHeightBefore;
  });

  const deleteToast = () => {
    // Save the offset for the exit swipe animation
    removed = true;
    offsetBeforeRemove = offset;
    onSetHeights?.(heights.filter((height) => height.toastId !== toast.id));

    setTimeout(() => {
      onRemoveToast?.(toast);
    }, TIME_BEFORE_UNMOUNT);
  };

  let timeoutId: ReturnType<typeof setTimeout>;

  // Pause the tmer on each hover
  const pauseTimer = () => {
    if (lastCloseTimerStartTimeRef < closeTimerStartTimeRef) {
      // Get the elapsed time since the timer started
      const elapsedTime = new Date().getTime() - closeTimerStartTimeRef;

      closeTimerRemainingTimeRef = closeTimerRemainingTimeRef - elapsedTime;
    }

    lastCloseTimerStartTimeRef = new Date().getTime();
  };

  const startTimer = () => {
    closeTimerStartTimeRef = new Date().getTime();
    // Let the toast know it has started
    timeoutId = setTimeout(() => {
      toast.onAutoClose?.(toast);
      deleteToast();
    }, closeTimerRemainingTimeRef);
  };

  let isPromiseLoadingOrInfiniteDuration = $derived((toast.promise && toastType === 'loading') || toast.duration === Number.POSITIVE_INFINITY);

  $effect(() => {
    if (!isPromiseLoadingOrInfiniteDuration) {
      if (expanded || interacting) {
        pauseTimer();
      } else {
        startTimer();
      }
    }

    return () => clearTimeout(timeoutId);
  });

  onMount(() => {
    mounted = true;

    const height = toastRef!.getBoundingClientRect().height;

    // Add toast height tot heights array after the toast is mounted
    initialHeight = height;
    onSetHeights?.([{ toastId: toast.id, height }, ...heights]);
  });

  onDestroy(() => {
    onSetHeights?.(heights.filter((height) => height.toastId !== toast.id));
  });

  $effect(() => {
    if (toast.delete) deleteToast();
  });

  function onPointerDown(event: PointerEvent) {
    if (disabled) {
      return;
    }

    offsetBeforeRemove = offset;
    // Ensure we maintain correct pointer capture even when going outside of the toast (e.g. when swiping)
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    if ((event.target as HTMLElement).tagName === 'BUTTON') {
      return;
    }
    swiping = true;
    pointerStartRef = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp() {
    if (swipeOut) {
      return;
    }

    pointerStartRef = null;
    const swipeAmount = Number(toastRef?.style.getPropertyValue('--swipe-amount').replace('px', '') || 0);

    // Remove only if treshold is met
    if (Math.abs(swipeAmount) >= SWIPE_TRESHOLD) {
      offsetBeforeRemove = offset;
      toast.onDismiss?.(toast);
      deleteToast();
      swipeOut = true;
      return;
    }

    toastRef!.style.setProperty('--swipe-amount', '0px');
    swiping = false;
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointerStartRef) {
      return;
    }

    const yPosition = event.clientY - pointerStartRef!.y;
    const xPosition = event.clientX - pointerStartRef!.x;

    const clamp = coords[0] === 'top' ? Math.min : Math.max;
    const clampedY = clamp(0, yPosition);
    const swipeStartThreshold = event.pointerType === 'touch' ? 10 : 2;
    const isAllowedToSwipe = Math.abs(clampedY) > swipeStartThreshold;

    if (isAllowedToSwipe) {
      toastRef!.style.setProperty('--swipe-amount', `${yPosition}px`);
    } else if (Math.abs(xPosition) > swipeStartThreshold) {
      // User is swiping in wrong direction so we disable swipe gesture
      // for the current pointer down interaction
      pointerStartRef = null;
    }
  }
</script>

<li
  bind:this={toastRef}
  aria-live={toast.important ? 'assertive' : 'polite'}
  aria-atomic="true"
  role="status"
  tabIndex={0}
  class={`${_class} ${toastClass}`}
  data-sonner-toast=""
  data-styled={!toast.component}
  data-mounted={mounted}
  data-promise={Boolean(toast.promise)}
  data-removed={removed}
  data-visible={isVisible}
  data-y-position={coords[0]}
  data-x-position={coords[1]}
  data-index={index}
  data-front={isFront}
  data-swiping={swiping}
  data-type={toastType}
  data-invert={invert}
  data-swipe-out={swipeOut}
  data-expanded={Boolean(expanded || (expandByDefault && mounted))}
  style={`${style || ''} ${toast.style}`}
  style:--index={index}
  style:--toasts-before={index}
  style:--z-index={toasts.length - index}
  style:--offset={`${removed ? offsetBeforeRemove : offset}px`}
  style:--initial-height={expandByDefault ? 'auto' : `${initialHeight}px`}
  onpointerdown={onPointerDown}
  onpointerup={onPointerUp}
  onpointermove={onPointerMove}
>
  {#if closeButton && !toast.component}
    <button
      aria-label="Close toast"
      data-disabled={disabled}
      data-close-button
      onclick={disabled
        ? undefined
        : () => {
            deleteToast();
            toast.onDismiss?.(toast);
          }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  {/if}

  {#if toast.component}
    <toast.component onCloseToast={deleteToast} />
  {:else if toast.title && typeof toast.title !== 'string'}
    <toast.title onCloseToast={deleteToast} />
  {:else}
    {#if toastType || toast.icon || toast.promise}
      <div data-icon="">
        {#if toast.promise}
          <Loader visible={toastType === 'loading'} />
        {/if}
        {#if toast.icon}
          <toast.icon />
        {:else}
          <Icon type={toastType} />
        {/if}
      </div>
    {/if}
    <div data-content="">
      <div data-title="">{toast.title}</div>
      {#if toast.description}
        <div data-description="" class={descriptionClass + toastDescriptionClass}>
          {toast.description}
        </div>
      {/if}
    </div>
    {#if toast.cancel}
      <button
        data-button
        data-cancel
        onclick={() => {
          deleteToast();
          if (toast.cancel?.onClick) {
            toast.cancel.onClick();
          }
        }}
      >
        {toast.cancel.label}
      </button>
    {/if}
    {#if toast.action}
      <button
        data-button=""
        onclick={(event) => {
          toast.action?.onClick(event);
          if (event.defaultPrevented) return;
          deleteToast();
        }}
      >
        {toast.action.label}
      </button>
    {/if}
  {/if}
</li>
