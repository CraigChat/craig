<script lang="ts">
  interface Props {
    id?: string | undefined;
    checked: boolean;
    disabled?: boolean;
  }

  let { id = undefined, checked = $bindable(), disabled = false }: Props = $props();
</script>

<input {id} type="checkbox" class="h-6 w-6 flex-none cursor-pointer" bind:checked {disabled} />

<style lang="scss">
  input[type='checkbox'] {
    --chkbg: #14b8a6;
    --chkfg: #000;
    @apply appearance-none rounded bg-zinc-700 shadow-sm transition-all;

    &:checked {
      background-image:
        linear-gradient(-45deg, transparent 65%, var(--chkbg) 65.99%), linear-gradient(45deg, transparent 75%, var(--chkbg) 75.99%),
        linear-gradient(-45deg, var(--chkbg) 40%, transparent 40.99%),
        linear-gradient(45deg, var(--chkbg) 30%, var(--chkfg) 30.99%, var(--chkfg) 40%, transparent 40.99%),
        linear-gradient(-45deg, var(--chkfg) 50%, var(--chkbg) 50.99%);
    }

    &:disabled {
      --chkbg: #3f3f46;
      @apply opacity-50;
    }
  }
</style>
