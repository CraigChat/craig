<script lang="ts">
  import { cn } from '$lib/util';

  interface Props {
    options: (string | null)[];
    selected?: string | null;
    displayOptions?: string[];
    disabled?: boolean;
  }

  let { options, selected = $bindable(null), displayOptions = [], disabled = false }: Props = $props();
</script>

<div class="flex w-full flex-col gap-0.5 overflow-hidden rounded text-sm font-medium sm:flex-row">
  {#each options as option, i}
    <button
      class={cn(
        'w-full bg-zinc-800 p-2 transition-colors disabled:opacity-50',
        selected === option ? 'bg-teal-700 text-white' : 'enabled:cursor-pointer enabled:hover:bg-zinc-700/50'
      )}
      data-selected={selected === option}
      {disabled}
      onclick={() => (selected = option)}
    >
      {displayOptions[i] ?? option}
    </button>
  {/each}
</div>
