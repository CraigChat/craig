<script lang="ts">
  import Icon from '@iconify/svelte';
  import errorIcon from '@iconify-icons/mdi/error';
  import helpIcon from '@iconify-icons/mdi/help';
  import range from 'just-range';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import Button from '$components/Button.svelte';
  import Checkbox from '$components/Checkbox.svelte';
  import ColorPicker from '$components/ColorPicker.svelte';
  import FallbackImage from '$components/FallbackImage.svelte';
  import SpreadSelect from '$components/SpreadSelect.svelte';
  import { loadingIcon } from '$lib/icons';
  import { jobPostError, jobPosting, postJob } from '$lib/recording/data';
  import type { RecordingPageEmitter } from '$lib/types';
  import { AVATAR_PLACEHOLDER, getAvatar } from '$lib/util';

  import IgnoreTracksSection from './IgnoreTracksSection.svelte';

  interface Props {
    emitter: RecordingPageEmitter;
    onclose?: () => void;
  }

  let { emitter, onclose }: Props = $props();
  const recording = page.data.recording!;
  const users = page.data.users!;
  const key = page.data.key!;

  let ignored = new SvelteSet<number>();
  let canDownload = $derived(ignored.size !== users.length);

  let helpOpen = $state(false);

  let glowHex = $state('#008000');
  let bgHex = $state('#000000');
  let transparent = $state(false);
  let format: 'mkvh264' | 'webmvp8' = $state('mkvh264');

  async function startDownload() {
    await postJob(emitter, onclose, recording, key, {
      type: 'avatars',
      options: {
        format,
        container: 'zip',
        transparent,
        fg: glowHex.slice(1),
        bg: bgHex.slice(1),
        ...(ignored.size ? { ignoreTracks: [...ignored] } : {})
      }
    });
  }
</script>

<div
  class="relative flex w-full justify-center gap-4 border-b-2 border-dashed p-6 md:p-12"
  style:background-color={!transparent ? bgHex : undefined}
  class:border-b-zinc-400={transparent}
  class:border-b-transparent={!transparent}
>
  {#each range(Math.min(4, users.length)) as i}
    <div class="relative h-12 w-12 rounded-full md:h-16 md:w-16">
      <FallbackImage
        {...users[i]?.avatar || users[i]?.avatarUrl ? { src: getAvatar(users[i]), fallbackSrc: AVATAR_PLACEHOLDER } : { src: AVATAR_PLACEHOLDER }}
        alt={$t('common.avatar')}
        class="h-full w-full rounded-full bg-black"
      />
      <div class="absolute left-0 top-0 h-full w-full animate-pulse rounded-full ring-2 md:ring-4" style:--tw-ring-color={glowHex}></div>
    </div>
  {/each}

  <button
    class="absolute bottom-2 left-2 h-6 w-6 transition-colors hover:text-white"
    style:filter="drop-shadow(0 0 1px #000)"
    title={$t('download.avatar_overlays.help_button')}
    onclick={() => (helpOpen = !helpOpen)}
  >
    <Icon icon={helpIcon} class="h-6 w-6" />
  </button>
</div>

<div class="flex w-full flex-col gap-4 overflow-y-auto p-6">
  {#if helpOpen}
    <div class="flex gap-2 rounded bg-zinc-600 p-2 text-xs text-white md:text-sm">
      <Icon icon={helpIcon} class="h-6 w-6 flex-none" />
      <p>{$t('download.avatar_overlays.help')}</p>
    </div>
  {/if}

  {#if $jobPostError}
    <div class="flex items-center gap-2 rounded bg-red-600 p-2 text-xs text-white md:text-sm">
      <Icon icon={errorIcon} class="h-6 w-6 flex-none" />
      <p>{$t(`errors.${$jobPostError}`)}</p>
    </div>
  {/if}

  <div class="flex w-full gap-2 text-sm">
    <div class="flex w-full flex-col" class:opacity-50={transparent} class:pointer-events-none={transparent}>
      <label for="ao-bg" class="pb-1 font-medium text-zinc-300">{$t('download.avatar_overlays.options.bg')}</label>
      <ColorPicker disabled={$jobPosting} id="ao-bg" bind:hex={bgHex} />
    </div>
    <div class="flex w-full flex-col">
      <label for="ao-fg" class="pb-1 font-medium text-zinc-300">{$t('download.avatar_overlays.options.fg')}</label>
      <ColorPicker disabled={$jobPosting} id="ao-fg" bind:hex={glowHex} />
    </div>
  </div>

  <div class="flex w-full flex-col gap-1">
    <div class="flex items-center justify-between">
      <label for="ao-t" class="w-full font-medium">{$t('download.avatar_overlays.options.transparent')}</label>
      <Checkbox id="ao-t" disabled={$jobPosting} bind:checked={transparent} />
    </div>
    <p class="text-xs text-zinc-400 sm:text-sm">
      {$t(`download.avatar_overlays.transparency_${format === 'mkvh264' ? 'mkv' : 'webm'}`)}
    </p>
  </div>

  <div class="flex w-full flex-col gap-1">
    <span class="font-medium text-zinc-300">{$t('download.avatar_overlays.options.format')}</span>
    <SpreadSelect disabled={$jobPosting} options={['mkvh264', 'webmvp8']} displayOptions={['MKV (MPEG-4)', 'WebM (VP8)']} bind:selected={format} />
  </div>

  {#if users.length > 1}
    <IgnoreTracksSection {ignored} />
  {/if}
</div>

<div class="flex w-full justify-between bg-zinc-950/40 px-6 py-3">
  <span></span>
  <Button primary disabled={$jobPosting || !canDownload} onclick={startDownload}>
    <div class="relative">
      <span class="transition-opacity" class:opacity-0={$jobPosting}>{$t('common.download')}</span>
      <div
        class="absolute bottom-0 left-0 right-0 top-0 flex scale-150 items-center justify-center transition-opacity"
        class:opacity-0={!$jobPosting}
        class:opacity-100={$jobPosting}
      >
        <Icon icon={loadingIcon} class="animate-spin" />
      </div>
    </div>
  </Button>
</div>
