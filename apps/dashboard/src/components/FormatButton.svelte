<script lang="ts">
  import Icon, { type IconifyIcon } from '@iconify/svelte';

  interface Props {
    selected?: boolean;
    disabled?: boolean;
    icon?: IconifyIcon | null;
    suffix?: string;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }

  let { selected = false, disabled = false, icon = null, suffix = '', onclick, children }: Props = $props();
</script>

<button class:selected {disabled} {onclick}>
  {#if icon}
    <Icon {icon} class="scale-125" />
  {/if}
  <div>
    <span>{@render children?.()}</span>
    {#if suffix}
      <small>{suffix}</small>
    {/if}
  </div>
</button>

<style>
  @reference "../app.css";

  button {
    min-width: 4em;
    @apply flex cursor-pointer items-center justify-center gap-2;
    @apply rounded border border-teal-500 px-3 py-1;
    @apply bg-teal-500/25 text-base font-medium text-teal-400 transition-all;

    & > div {
      @apply flex items-center justify-center gap-1;

      & > small {
        @apply whitespace-nowrap text-sm font-normal;
      }
    }

    @media screen and (max-width: 640px) {
      @apply px-2 text-sm;
    }

    &.selected {
      @apply border-neutral-100 bg-neutral-200/25 text-neutral-200 ring ring-white;
    }

    &:hover:not(.selected) {
      @apply bg-teal-500/50 text-white;
    }

    &:active {
      @apply opacity-75;
    }

    &:disabled {
      @apply pointer-events-none opacity-50;
    }
  }
</style>
