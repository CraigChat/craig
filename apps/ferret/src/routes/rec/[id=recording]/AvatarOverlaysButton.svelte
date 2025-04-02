<script lang="ts">
  import range from 'just-range';
  import { fade, fly } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import Portal from 'svelte-portal';

  import { page } from '$app/state';
  import FallbackImage from '$components/FallbackImage.svelte';
  import type { RecordingPageEmitter } from '$lib/types';
  import { AVATAR_PLACEHOLDER, getAvatar } from '$lib/util';

  import AvatarOverlaysModal from './AvatarOverlaysModal.svelte';

  const users = page.data.users!;
  interface Props {
    emitter: RecordingPageEmitter;
  }

  let { emitter }: Props = $props();

  let modalOpen = $state(false);
  function onModalClick(this: any, e: any) {
    if (e.target === this) modalOpen = false;
  }
</script>

<button
  class="group relative flex min-h-[6rem] flex-col justify-center gap-1 overflow-hidden rounded-md bg-zinc-700 px-6 py-4 text-left shadow transition-all hover:bg-zinc-600 active:opacity-75"
  onclick={() => (modalOpen = true)}
>
  <div class="z-10 flex flex-col justify-center gap-1 sm:w-max">
    <span class="font-display text-bg text-xl font-bold text-white">{$t('download.avatar_overlays.button_name')}</span>
    <span class="text-bg text-sm text-neutral-300">{$t('download.avatar_overlays.button_description')}</span>
  </div>

  <div class="pointer-events-none absolute bottom-0 right-0 top-0 flex flex-col justify-center gap-2 opacity-50 md:opacity-100">
    <div class="flex gap-4 transition-all group-hover:-translate-x-2 group-hover:gap-6">
      {#each range(3) as i}
        {@const index = i * 2}
        <div class="relative h-8 w-8 scale-90 rounded-full transition-all group-hover:scale-100">
          <FallbackImage
            {...users[index]?.avatar || users[index]?.avatarUrl
              ? { src: getAvatar(users[index]), fallbackSrc: AVATAR_PLACEHOLDER }
              : { src: AVATAR_PLACEHOLDER }}
            alt={$t('common.avatar')}
            class="h-full w-full rounded-full bg-black"
          />
          <div class="absolute left-0 top-0 h-full w-full rounded-full ring-2 ring-green-500 group-hover:animate-pulse"></div>
        </div>
      {/each}
    </div>
    <div class="flex translate-x-6 gap-4 transition-all group-hover:translate-x-6 group-hover:gap-6">
      {#each range(3) as i}
        {@const index = i * 2 + 1}
        <div class="relative h-8 w-8 scale-90 rounded-full transition-all group-hover:scale-100">
          <FallbackImage
            {...users[index]?.avatar || users[index]?.avatarUrl
              ? { src: getAvatar(users[index]), fallbackSrc: AVATAR_PLACEHOLDER }
              : { src: AVATAR_PLACEHOLDER }}
            alt={$t('common.avatar')}
            class="h-full w-full rounded-full bg-black"
          />
          <div class="absolute left-0 top-0 h-full w-full rounded-full ring-2 ring-green-500 group-hover:animate-pulse"></div>
        </div>
      {/each}
    </div>
  </div>

  <div
    class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-zinc-700/90 to-transparent transition-all group-hover:h-8 group-hover:from-zinc-600/90"
  ></div>
</button>

{#if modalOpen}
  <Portal target="body">
    <div
      transition:fade={{ duration: 100 }}
      class="fixed bottom-0 left-0 right-0 top-0 z-30 flex select-none items-end justify-center bg-black/40 backdrop-blur-sm md:items-center md:px-8"
      aria-hidden="true"
      onclick={onModalClick}
    >
      <div
        transition:fly={{ duration: 250, y: 32 }}
        class="relative inline-flex max-h-[calc(100svh-6rem)] w-[1024px] flex-col items-start justify-start overflow-hidden rounded-t-lg bg-zinc-900 text-neutral-300 shadow-lg ring-2 ring-black/50 md:rounded-b-lg"
      >
        <AvatarOverlaysModal {emitter} onclose={() => (modalOpen = false)} />
      </div>
    </div>
  </Portal>
{/if}

<style lang="scss">
  .text-bg {
    @apply rounded-lg bg-zinc-700/50 ring-4 ring-zinc-700/50 backdrop-blur-md transition-all;

    button:hover & {
      @apply bg-zinc-600/50 ring-zinc-600/50;
    }
  }
</style>
