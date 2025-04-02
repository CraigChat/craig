<script lang="ts">
  import { fade } from 'svelte/transition';
  import ColorPicker from 'svelte-awesome-color-picker';
  import { createFloatingActions } from 'svelte-floating-ui';
  import { autoPlacement, offset, shift } from 'svelte-floating-ui/dom';
  import { t } from 'svelte-i18n';
  import Portal from 'svelte-portal';

  interface Props {
    id?: string | undefined;
    hex: string;
    disabled?: boolean;
  }

  let { id = undefined, hex = $bindable(), disabled = false }: Props = $props();
  let wrapper = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();
  let popupOpen = $state(false);

  function mousedown({ target }: MouseEvent) {
    if (popupOpen && !wrapper!.contains(target as Node) && !button!.contains(target as Node)) popupOpen = false;
  }

  const [floatingRef, floatingContent] = createFloatingActions({
    strategy: 'absolute',
    placement: 'bottom-start',
    middleware: [offset(16), shift(), autoPlacement()]
  });
</script>

<svelte:window onmousedown={mousedown} />

<button
  {id}
  class="flex w-full items-center gap-2 rounded bg-zinc-700 px-4 py-2 shadow transition-all active:opacity-75 hover:enabled:bg-zinc-600 disabled:opacity-50"
  use:floatingRef
  onclick={() => (popupOpen = true)}
  {disabled}
  bind:this={button}
>
  <div class="h-4 w-4 rounded-full ring-2 ring-inset ring-black/20" style:background-color={hex}></div>
  <span class="font-mono">{hex}</span>
</button>

{#if popupOpen}
  <Portal target="body">
    <div bind:this={wrapper} use:floatingContent class="color-picker-dialog z-50 -mx-2.5 -mb-2.5" transition:fade={{ duration: 100 }}>
      <ColorPicker
        bind:hex
        isAlpha={false}
        isDialog={false}
        texts={{
          label: {
            h: $t('color_picker.h'),
            s: $t('color_picker.s'),
            v: $t('color_picker.v'),
            r: $t('color_picker.r'),
            g: $t('color_picker.g'),
            b: $t('color_picker.b'),
            a: $t('color_picker.a'),
            hex: $t('color_picker.hex'),
            withoutColor: $t('color_picker.without_color')
          },
          color: {
            rgb: 'RGB',
            hsv: 'HSV',
            hex: 'HEX'
          },
          changeTo: $t('color_picker.change_to')
        }}
      />
    </div>
  </Portal>
{/if}

<style lang="scss">
  .color-picker-dialog {
    --cp-bg-color: #18181b;
    --cp-border-color: #a1a1aa;
    --cp-text-color: white;
    --cp-input-color: #3f3f46;
    --cp-button-hover-color: #71717a;

    :global(.wrapper) {
      @apply shadow-md shadow-black;
    }
  }
</style>
