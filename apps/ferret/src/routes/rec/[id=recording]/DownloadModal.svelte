<script lang="ts">
  import Icon from '@iconify/svelte';
  import errorIcon from '@iconify-icons/mdi/error';
  import folderIcon from '@iconify-icons/mdi/folder';
  import cornerIcon from '@iconify-icons/radix-icons/corner-bottom-left';
  import { onMount } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import Button from '$components/Button.svelte';
  import Checkbox from '$components/Checkbox.svelte';
  import Modal from '$components/Modal.svelte';
  import { PUBLIC_ENNUIZEL_API_HOSTNAME, PUBLIC_ENNUIZEL_URL } from '$env/static/public';
  import { ennuizelWarned } from '$lib/data';
  import { getFileIcon, loadingIcon } from '$lib/icons';
  import { jobPostError, jobPosting, postJob } from '$lib/recording/data';
  import { type Description, descriptions } from '$lib/recording/descriptions';
  import type { FocusedButton } from '$lib/recording/sections';
  import type { RecordingPageEmitter } from '$lib/types';
  import { convertT, formatUser } from '$lib/util';

  import IgnoreTracksSection from './IgnoreTracksSection.svelte';

  const recording = page.data.recording!;
  const users = page.data.users!;
  const key = page.data.key!;

  interface Props {
    emitter: RecordingPageEmitter;
    button: FocusedButton;
    onclose?: () => void;
  }

  const FormatToExt: Record<string, string> = {
    heaac: 'aac',
    vorbis: 'ogg',
    oggflac: 'oga',
    adpcm: 'wav',
    wav8: 'wav'
  };

  let { emitter, button, onclose }: Props = $props();
  let extension = $derived(FormatToExt[button.options?.format ?? ''] ?? button.options?.format);
  let buttonText = $derived(convertT(button.text, $t));
  let sectionText = $derived(convertT(button.section, $t));
  let descriptionKey = $derived(button.url ?? `${button.options?.format ?? '-'}:${button.options?.container ?? '-'}`);
  let desc = $derived(
    descriptions[descriptionKey] ??
      (button.options?.container === 'mix'
        ? ({
            file: `.${extension}`,
            description: { t: 'download.modal.description.mix', values: { file: buttonText } }
          } as Description)
        : ({
            file: `.${extension}.zip`,
            zipContents: [
              {
                name: `{user}.${extension}`
              },
              {
                name: '...'
              },
              {
                name: 'info.txt'
              },
              {
                name: 'raw.dat'
              }
            ],
            description: { t: 'download.modal.description.zip', values: { file: buttonText } }
          } as Description))
  );
  let title = $derived(desc.title ?? buttonText);
  const firstUser = formatUser(users[0]) ?? '';
  let normalization = $state(false);
  let excludeNormalization = new SvelteSet<number>();
  let canIgnore = $derived(!button.noIgnore && users.length > 1);
  let ignored = new SvelteSet<number>();
  let canDownload = $derived(ignored.size !== users.length);

  $effect(() => {
    if (excludeNormalization.size && !normalization) excludeNormalization.clear();
  });
  $effect(() => {
    for (const track of ignored) {
      if (excludeNormalization.has(track)) excludeNormalization.delete(track);
    }
  });

  let ennuizel = !!button.ennuizel;
  let ezTimerTween = new Tween(5);
  let ezTimer = $derived(Math.ceil(ezTimerTween.current));
  let ezEnable = $derived(ezTimer === 0);
  let ezUrl = `${PUBLIC_ENNUIZEL_URL}?i=${recording.id}&k=${key}&w=${(button.ennuizel ?? 0).toString(36)}&a=${PUBLIC_ENNUIZEL_API_HOSTNAME || location.host}`;

  async function startDownload() {
    if (ennuizel) {
      open(ezUrl, '_blank');
      onclose?.();
      ennuizelWarned.set(true);
    } else if (button.url) {
      open(`/api/v1/recordings/${recording.id}${button.url}?key=${key}`, '_blank');
      onclose?.();
    } else
      await postJob(emitter, onclose, recording, key, {
        type: 'recording',
        options: {
          ...button.options,
          ...(button.allowNorm
            ? {
                dynaudnorm: normalization,
                ...(excludeNormalization ? { skipDynaudnorm: [...excludeNormalization] } : {})
              }
            : {}),
          ...(ignored.size && canIgnore ? { ignoreTracks: [...ignored] } : {})
        }
      });
  }

  onMount(() => {
    if (ennuizel) ezTimerTween.set(0, { duration: $ennuizelWarned ? 0 : 5000 });
  });
</script>

<Modal
  title={$t(ennuizel ? 'download.ennuizel_modal.header' : 'download.modal.header')}
  subtitle={!ennuizel
    ? $t('download.modal.subtext', { values: { file: desc?.file.split('.').reverse()[0].toUpperCase() ?? buttonText } })
    : undefined}
>
  {#if ennuizel}
    <div class="text-sm sm:text-base">
      {$t('download.ennuizel_modal.description')}
    </div>

    <div class="self-stretch">
      <h4 class="font-display text-base font-semibold text-neutral-100 sm:text-lg">{$t('download.ennuizel_modal.selected_format')}</h4>
      <span class="text-xs sm:text-sm">
        {sectionText} / {buttonText}
      </span>
    </div>
  {:else}
    {#if $jobPostError}
      <div class="flex items-center gap-2 rounded bg-red-600 p-2 text-xs text-white md:text-sm">
        <Icon icon={errorIcon} class="h-6 w-6 flex-none" />
        <p>{$t(`errors.${$jobPostError}`)}</p>
      </div>
    {/if}

    {#if desc}
      <div class="flex flex-col rounded bg-zinc-800">
        <div class="flex gap-2 rounded-t bg-zinc-700 px-2 py-1 text-white">
          <Icon icon={getFileIcon(desc.file)} class="h-6 w-6" />
          <span>{desc.file.startsWith('.') || desc.file.startsWith('-') ? `craig-${recording.id}${desc.file}` : desc.file}</span>
        </div>
        {#if desc.zipContents}
          {#each desc.zipContents as file}
            {#if file.name !== '...' || users.length > 1}
              <div class="ml-4 flex gap-2 px-2 py-1" class:text-teal-400={file.runnable}>
                {#if file.name === '...'}
                  <span class="ml-8 text-sm opacity-50">{users.length - 1} more...</span>
                {:else}
                  <Icon icon={file.folder ? folderIcon : getFileIcon(file.name)} class="h-6 w-6" />
                  <span>{file.name.replace('{id}', recording.id).replace('{user}', firstUser)}</span>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      <div class="self-stretch">
        <h4 class="font-display text-lg font-semibold text-neutral-100 sm:text-xl">
          {convertT(title, $t)}
        </h4>
        <span class="text-xs sm:text-sm">
          {desc.description ? convertT(desc.description, $t) : $t('download.modal.description.zip', { values: { file: buttonText } })}
        </span>
      </div>

      {#if button.allowNorm || canIgnore}
        <hr class="border-white/20" />
      {/if}

      {#if button.allowNorm}
        <div class="flex w-full flex-col gap-1">
          <div class="flex items-center justify-between">
            <label for="dl-dynaudnorm" class="w-full font-medium">{$t('download.modal.normalize_audio')}</label>
            <Checkbox id="dl-dynaudnorm" disabled={$jobPosting} bind:checked={normalization} />
          </div>
          {#if normalization && ignored.size !== users.length && users.length - ignored.size > 1}
            <div class="flex gap-1">
              <Icon icon={cornerIcon} class="h-6 w-6 opacity-50" />
              <IgnoreTracksSection
                name={$t('download.exclude_user.exclude_from_normalization')}
                ignored={excludeNormalization}
                previouslyIgnored={ignored}
                allIgnoredText={$t('download.exclude_user.all_excluded_normalization_warning')}
              />
            </div>
          {/if}
        </div>
      {/if}

      {#if canIgnore}
        <IgnoreTracksSection {ignored} />
      {/if}
    {/if}
  {/if}

  {#snippet buttons()}
    <Button onclick={onclose}>
      {$t('common.cancel')}
    </Button>
    {#if !ennuizel}
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
    {:else}
      <Button primary disabled={!ezEnable} onclick={startDownload}>
        {$t('download.ennuizel_modal.confirm')}
        {#if !ezEnable}
          ({ezTimer})
        {/if}
      </Button>
    {/if}
  {/snippet}
</Modal>
