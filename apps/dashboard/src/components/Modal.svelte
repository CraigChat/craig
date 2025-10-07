<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import Portal from 'svelte-portal';
  import { trapFocus } from 'trap-focus-svelte';

  import { cn } from '$lib/util';

  function onModalClick(this: any, e: any) {
    if (e.target === this && allowClose) onclose?.();
  }

  interface Props {
    allowClose?: boolean;
    children?: import('svelte').Snippet;
    class?: string;
    onclose?: () => void;
  }

  let { allowClose = true, class: wrapperClass, children, onclose }: Props = $props();
</script>

<Portal target="body">
  <div
    transition:fade={{ duration: 100 }}
    class="fixed bottom-0 left-0 right-0 top-0 z-30 flex select-none items-center justify-center bg-black/40 px-2 backdrop-blur-sm md:px-8"
    aria-hidden="true"
    onclick={onModalClick}
    use:trapFocus
  >
    <div
      transition:scale={{ duration: 250, opacity: 0, start: 0.95 }}
      class={cn(
        'relative inline-flex max-h-[calc(100svh-6rem)] w-[1024px] flex-col items-start justify-start overflow-hidden rounded-t-lg bg-zinc-900 text-zinc-300 shadow-lg ring-2 ring-black/50 md:rounded-b-lg',
        wrapperClass
      )}
    >
      {@render children?.()}
    </div>
  </div>
</Portal>
