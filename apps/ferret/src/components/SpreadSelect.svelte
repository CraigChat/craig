<script lang="ts">
  interface Props {
    options: string[];
    selected?: string | null;
    displayOptions?: string[];
    disabled?: boolean;
  }

  let { options, selected = $bindable(null), displayOptions = [], disabled = false }: Props = $props();
</script>

<div>
  {#each options as option, i}
    <button class:selected={selected === option} {disabled} onclick={() => (selected = option)}>
      {displayOptions[i] ?? option}
    </button>
  {/each}
</div>

<style lang="scss">
  div {
    @apply flex w-full gap-0.5 overflow-hidden rounded text-sm;
  }

  button {
    @apply w-full bg-zinc-800 p-2 transition-colors;

    &:hover:not(.selected):not(:disabled) {
      @apply bg-zinc-700/50;
    }

    &.selected {
      @apply bg-zinc-700 text-white;
    }

    &:disabled {
      @apply opacity-50;
    }
  }
</style>
