<script lang="ts">
  import type { Snippet } from 'svelte';

  import { cn } from '$lib/util';

  interface Props {
    title: string;
    subtitle?: string;
    children?: Snippet;
    buttons?: Snippet;
    class?: string;
  }

  let { title, subtitle, children, buttons, class: _class }: Props = $props();
</script>

<div class="z-10 flex w-full flex-col gap-4 overflow-y-auto p-6">
  <div class=" self-stretch leading-tight">
    <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">{title}</h2>
    {#if subtitle}
      <span class="text-sm sm:text-base">
        {subtitle}
      </span>
    {/if}
  </div>

  {@render children?.()}
</div>

<div class={cn('flex w-full items-center justify-between bg-zinc-950/40 px-6 py-3', _class)}>
  <span></span>
  <div class="flex gap-2">
    {@render buttons?.()}
  </div>
</div>
