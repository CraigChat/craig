<script lang="ts">
  import Icon, { type IconifyIcon } from '@iconify/svelte';

  interface Props {
    ennuizel?: boolean;
    minizel?: boolean;
    disabled?: boolean;
    icon?: IconifyIcon | null;
    suffix?: string;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }

  let { ennuizel = false, minizel = false, disabled = false, icon = null, suffix = '', onclick, children }: Props = $props();
</script>

<button class:ennuizel class:minizel {disabled} {onclick}>
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

<style lang="scss">
  button {
    min-width: 4em;
    @apply flex items-center justify-center gap-2;
    @apply rounded border border-teal-500 px-3 py-1;
    @apply bg-teal-500 bg-opacity-25 text-base font-medium text-teal-400 transition-all;

    & > div {
      @apply flex items-center justify-center gap-1;

      & > small {
        @apply whitespace-nowrap text-sm font-normal;
      }
    }

    @media screen and (max-width: 640px) {
      @apply px-2 text-sm;
    }

    &.ennuizel {
      @apply border-red-500 bg-red-500 bg-opacity-25 text-red-400;
    }

    &.minizel {
      @apply border-purple-500 bg-purple-500 bg-opacity-25 text-purple-400;
    }

    &:hover {
      @apply bg-opacity-50 text-white;
    }

    &:active {
      @apply opacity-75;
    }

    &:disabled {
      @apply pointer-events-none opacity-50;
    }
  }
</style>
