<script lang="ts">
  import { Label, Switch } from 'bits-ui';
  import type { Snippet } from 'svelte';

  import { cn } from '$lib/util';

  const id = $props.id();
  type Props = {
    checked?: boolean;
    label?: string;
    labelClass?: string;
    switchClass?: string;
    wrapperClass?: string;
    description?: string | Snippet;
    disabled?: boolean;
  };
  let { checked = $bindable(false), disabled, label = 'Switch', labelClass, switchClass, wrapperClass, description }: Props = $props();
</script>

<div class={cn('flex w-full items-center gap-2', wrapperClass)}>
  <div class="flex flex-1 flex-col gap-1">
    <Label.Root
      id={`${id}-label`}
      for={id}
      class={cn('text-base font-medium leading-none text-neutral-200 peer-disabled:cursor-not-allowed sm:text-lg', labelClass)}
    >
      {label}
    </Label.Root>
    {#if description}
      <p class="text-sm text-neutral-400">
        {#if typeof description !== 'string'}
          {@render description()}
        {:else}
          {description}
        {/if}
      </p>
    {/if}
  </div>
  <Switch.Root
    {id}
    aria-labelledby={`${id}-switch`}
    class={cn(
      'focus-visible:outline-hidden inline-flex h-[36px] min-h-[36px] w-[60px] flex-none shrink-0 cursor-pointer items-center rounded-full px-[3px] transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-teal-500 data-[state=unchecked]:bg-zinc-600',
      switchClass
    )}
    bind:checked
    {disabled}
  >
    <Switch.Thumb
      class="pointer-events-none block size-7 shrink-0 rounded-full bg-zinc-200 shadow shadow-black/75 transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0"
    />
  </Switch.Root>
</div>
