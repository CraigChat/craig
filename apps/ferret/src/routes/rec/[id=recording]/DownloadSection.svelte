<script lang="ts">
  import Icon from '@iconify/svelte';
  import lockIcon from '@iconify-icons/mdi/lock';
  import warnIcon from '@iconify-icons/mdi/warning';
  import { fade, fly } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import Portal from 'svelte-portal';

  import FormatButton from '$components/FormatButton.svelte';
  import RequiresTier from '$components/RequiresTier.svelte';
  import { device } from '$lib/device';
  import { jobOpen } from '$lib/recording/data';
  import { audioButtons, type FocusedButton, type SectionButton, transcriptionButtons } from '$lib/recording/sections';
  import type { MinimalRecordingInfo, RecordingPageEmitter } from '$lib/types';
  import { convertT, type Translatable } from '$lib/util';

  import AvatarOverlaysButton from './AvatarOverlaysButton.svelte';
  import DownloadAvatarsButton from './DownloadAvatarsButton.svelte';
  import DownloadModal from './DownloadModal.svelte';
  import WhichDoIUse from './WhichDoIUse.svelte';

  interface Props {
    emitter: RecordingPageEmitter;
    features: MinimalRecordingInfo['features'];
    noUsers?: boolean;
  }

  let { emitter, features, noUsers }: Props = $props();

  function onButtonClick(button: SectionButton, section: Translatable) {
    focusedButton = { ...button, section };
  }

  let audioShowHidden = $state(false);
  let showWDIU = $state(false);

  let focusedButton: FocusedButton | null = $state(null);
  function onModalClick(this: any, e: any) {
    if (e.target === this) {
      focusedButton = null;
      showWDIU = false;
    }
  }
</script>

{#if noUsers}
  <div class="z-[1] inline-flex flex-col justify-start rounded-2xl bg-zinc-900 shadow">
    <div class="self-stretch p-6">
      <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">{$t('download.no_users')}</h2>
      <span class="text-sm sm:text-base">
        <Icon icon={warnIcon} inline class="inline" />
        {$t('download.no_users_description')}
      </span>
    </div>
  </div>
{:else if !$jobOpen}
  <div class="shadow-section z-[1] inline-flex flex-col justify-start rounded-2xl bg-zinc-900">
    <div class="self-stretch px-6 pb-3 pt-6">
      <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">{$t('download.sections.downloads')}</h2>
      <button class="text-sm font-medium transition-colors hover:text-neutral-200" onclick={() => (showWDIU = true)}
        >{$t('download.wdiu.name')}</button
      >
    </div>
    <div class="flex flex-col items-start justify-start gap-3 p-6">
      <div class="inline-flex items-center justify-between self-stretch">
        <h3 class="font-display text-xl font-semibold text-neutral-100">{$t('download.sections.audio')}</h3>
        <button class="text-xs text-neutral-500" onclick={() => (audioShowHidden = !audioShowHidden)}>
          {$t(audioShowHidden ? 'common.show_less' : 'download.show_all_formats')}
        </button>
      </div>
      {#each audioButtons as section}
        {@const sectionAvailable =
          (!section.features || !section.features.map((f) => features.includes(f)).includes(false)) &&
          (!section.showFor || audioShowHidden || section.showFor.map((f) => device.platform[f]).includes(true))}
        {#if sectionAvailable}
          <div class="inline-flex flex-col items-start justify-start gap-2">
            <div class="text-base font-medium text-neutral-400">{convertT(section.title, $t)}</div>
            <div class="inline-flex flex-wrap items-start justify-start gap-3 self-stretch">
              {#each section.buttons as button}
                {@const featureAvailable = !button.features || !button.features.map((f) => features.includes(f)).includes(false)}
                {@const available = !button.showFor || button.showFor.map((f) => device.platform[f]).includes(true)}
                {#if featureAvailable && (available || audioShowHidden)}
                  <FormatButton
                    ennuizel={!!button.ennuizel}
                    suffix={button.suffix}
                    icon={button.icon}
                    onclick={() => onButtonClick(button, section.title)}
                  >
                    {convertT(button.text, $t)}
                  </FormatButton>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="flex flex-col items-stretch justify-start gap-3 p-6">
      <div class="inline-flex items-center gap-1 self-stretch">
        <h3 class="font-display text-xl font-semibold text-neutral-100">{$t('download.sections.transcription')}</h3>
        <span class="rounded-full bg-amber-400 px-2 py-1 text-xs font-bold uppercase text-black">{$t('common.new')}</span>
      </div>
      {#if features.includes('transcription')}
        <div class="inline-flex flex-wrap items-start justify-start gap-3 self-stretch">
          {#each transcriptionButtons as button}
            {@const featureAvailable = !button.features || !button.features.map((f) => features.includes(f)).includes(false)}
            {@const available = !button.showFor || button.showFor.map((f) => device.platform[f]).includes(true)}
            {#if featureAvailable && (available || audioShowHidden)}
              <FormatButton
                suffix={button.suffix}
                icon={button.icon}
                onclick={() => onButtonClick({ ...button, jobType: 'transcription' }, $t('download.sections.transcription'))}
              >
                {convertT(button.text, $t)}
              </FormatButton>
            {/if}
          {/each}
        </div>
      {:else}
        <RequiresTier minTier={30} />
      {/if}
    </div>

    <div class="flex flex-col items-stretch justify-start gap-3 p-6">
      <div class="inline-flex items-center justify-between self-stretch">
        <h3 class="font-display text-xl font-semibold text-neutral-100">{$t('download.sections.avatars')}</h3>
      </div>
      <DownloadAvatarsButton />
      {#if features.includes('glowers')}
        <AvatarOverlaysButton {emitter} />
      {/if}
    </div>
  </div>
{:else}
  <div class="z-[1] inline-flex flex-col justify-start rounded-2xl bg-zinc-900 shadow">
    <div class="self-stretch p-6">
      <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">{$t('download.sections.downloads')}</h2>
      <span class="text-sm sm:text-base">
        <Icon icon={lockIcon} inline class="inline" />
        {$t('download.active_download_description')}
      </span>
    </div>
  </div>
{/if}

{#if showWDIU}
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
        <WhichDoIUse onclose={() => (showWDIU = false)} />
      </div>
    </div>
  </Portal>
{/if}

{#if focusedButton}
  <Portal target="body">
    <div
      transition:fade={{ duration: 100 }}
      class="fixed bottom-0 left-0 right-0 top-0 z-30 flex select-none items-end justify-center bg-black/40 backdrop-blur-sm md:items-center md:px-8"
      aria-hidden="true"
      onclick={onModalClick}
    >
      <div
        transition:fly={{ duration: 250, y: 32 }}
        class={`relative inline-flex max-h-[calc(100svh-6rem)] w-[1024px] flex-col items-start justify-start overflow-hidden rounded-t-lg bg-zinc-900 text-neutral-300 shadow-lg ring-2 ${!focusedButton.ennuizel ? 'ring-black/50' : 'ring-red-950/25'} md:rounded-b-lg`}
      >
        {#if !!focusedButton.ennuizel}
          <div class="absolute left-0 right-0 top-0 z-0 h-40 max-h-[75%] bg-gradient-to-b from-red-600 to-transparent opacity-25"></div>
        {/if}
        <DownloadModal {emitter} button={focusedButton} onclose={() => (focusedButton = null)} />
      </div>
    </div>
  </Portal>
{/if}
