<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string | Snippet;
    subtitle?: string;
    children?: Snippet;
    buttons?: Snippet;
  }

  let { title, subtitle, children, buttons }: Props = $props();
</script>

<div class="z-10 flex w-full flex-col gap-4 overflow-y-auto p-6">
  <div class=" self-stretch leading-tight">
    <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">
      {#if typeof title === 'string'}
        {title}
      {:else}
        {@render title?.()}
      {/if}
    </h2>
    {#if subtitle}
      <span class="text-sm sm:text-base">
        {subtitle}
      </span>
    {/if}
  </div>

  {@render children?.()}
</div>

<div class="flex w-full items-center justify-between bg-zinc-950/40 px-6 py-3">
  <span></span>
  <div class="flex gap-2">
    {@render buttons?.()}
  </div>
</div>
