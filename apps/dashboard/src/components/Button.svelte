<script lang="ts">
  interface Props {
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
    transparent?: boolean;
    bigdanger?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }

  let { primary = false, danger = false, disabled = false, transparent = false, bigdanger = false, onclick, children }: Props = $props();
</script>

<button class:danger class:primary class:transparent class:bigdanger {disabled} {onclick}>
  {@render children?.()}
</button>

<style>
  @reference "../app.css";

  button {
    @apply flex cursor-pointer items-center justify-start gap-2;
    @apply rounded border border-neutral-200/25 px-3 py-1;
    @apply text-base font-medium text-neutral-400 transition-all;

    @media screen and (max-width: 640px) {
      @apply px-2 text-sm;
    }

    &:hover {
      @apply bg-white/5 text-neutral-200;
    }

    &.primary {
      @apply border-teal-600/75 bg-teal-600 text-white;

      &:hover {
        @apply bg-teal-600/50;
      }
    }

    &.danger {
      @apply border-red-200/25 text-red-600;
      &:hover {
        @apply bg-red-600/10;
      }
    }

    &.bigdanger {
      @apply border-red-600/75 bg-red-600 text-white;
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
