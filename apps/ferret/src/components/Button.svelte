<script lang="ts">
  interface Props {
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
    transparent?: boolean;
    bigdanger?: boolean;
    badge?: string;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }

  let { primary = false, danger = false, disabled = false, transparent = false, bigdanger = false, badge, onclick, children }: Props = $props();
</script>

<button class:danger class:primary class:transparent class:bigdanger {disabled} {onclick}>
  {@render children?.()}
  {#if badge}
    <span class="badge">{badge}</span>
  {/if}
</button>

<style lang="scss">
  button {
    @apply flex items-center justify-start gap-2;
    @apply rounded border border-neutral-200/25 px-3 py-1;
    @apply text-base font-medium text-neutral-400 transition-all;

    .badge {
      @apply rounded border border-neutral-400 px-1 py-0.5 text-xs text-neutral-400 transition-all delay-0;
    }

    @media screen and (max-width: 640px) {
      @apply px-2 text-sm;
    }

    &:hover {
      @apply bg-white/5 text-neutral-200;
      .badge {
        @apply border-neutral-200 text-neutral-200;
      }
    }

    &.primary {
      @apply border-teal-600/75 bg-teal-600 text-white;

      &:hover {
        @apply bg-teal-600/50;
      }
    }

    &.danger {
      @apply border-red-200/25 text-red-600;
      .badge {
        @apply border-red-600/50;
      }

      &:hover {
        @apply bg-red-600/10;
      }
    }

    &.bigdanger {
      @apply border-red-600/75 bg-red-600 text-white;
      .badge {
        @apply border-red-600/50;
      }

      &:hover {
        @apply bg-red-600/50;
      }
    }

    &.transparent {
      @apply border-transparent;

      &:hover {
        @apply bg-transparent;
      }
    }

    &:active {
      @apply opacity-75;
    }

    &:disabled {
      @apply pointer-events-none opacity-50;
    }
  }
</style>
