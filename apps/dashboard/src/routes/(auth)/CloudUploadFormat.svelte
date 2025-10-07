<script lang="ts">
  import type { DriveOptions } from '@craig/types';
  import Icon from '@iconify/svelte';
  import auditionIcon from '@iconify-icons/file-icons/adobe-audition';
  import audacityIcon from '@iconify-icons/file-icons/audacity';
  import rightIcon from '@iconify-icons/mdi/chevron-right';
  import audioIcon from '@iconify-icons/mdi/file-music';
  import zipIcon from '@iconify-icons/mdi/folder-zip';
  import { t } from 'svelte-i18n';

  import Button from '$components/Button.svelte';
  import FormatButton from '$components/FormatButton.svelte';
  import InnerModal from '$components/InnerModal.svelte';
  import Modal from '$components/Modal.svelte';
  import RequiresTier from '$components/RequiresTier.svelte';
  import SwitchField from '$components/SwitchField.svelte';
  import { savingSettings, updateSettings } from '$lib/data';
  import { loadingIcon } from '$lib/icons';
  import { convertT } from '$lib/util';

  let showModal = $state(false);

  interface Props {
    disabled?: boolean;
    driveFormat?: string | null;
    driveContainer?: string | null;
    driveOptions?: DriveOptions | null;
    rewardTier?: number;
  }

  const sections = [
    {
      id: 'mt',
      icon: zipIcon
    },
    {
      id: 'stsm',
      minTier: 20,
      icon: audioIcon
    }
  ];

  const formats = [
    {
      id: 'flac-aupzip',
      section: 'mt',
      icon: audacityIcon,
      text: { t: 'format_buttons.audacity' },
      allowNorm: true
    },
    {
      id: 'flac-sesxzip',
      section: 'mt',
      icon: auditionIcon,
      text: { t: 'format_buttons.adobe_audition' },
      allowNorm: true
    },
    {
      id: 'flac-zip',
      section: 'mt',
      text: 'FLAC',
      allowNorm: true
    },
    {
      id: 'aac-zip',
      section: 'mt',
      text: 'AAC',
      suffix: '(MPEG-4)',
      allowNorm: true
    },

    // Others
    { id: 'oggflac-zip', section: 'mt', text: 'Ogg FLAC', allowNorm: true },
    { id: 'heaac-zip', section: 'mt', text: 'HE-AAC', allowNorm: true },
    { id: 'opus-zip', section: 'mt', text: 'Opus', allowNorm: true },
    { id: 'adpcm-zip', section: 'mt', text: 'ADPCM wav', allowNorm: true },
    { id: 'wav8-zip', section: 'mt', text: '8-bit wav', allowNorm: true },

    // single track smart mix
    { id: 'flac-mix', text: 'FLAC', section: 'stsm' },
    { id: 'vorbis-mix', text: 'Ogg Vorbis', section: 'stsm' },
    { id: 'aac-mix', text: 'AAC', suffix: '(MPEG-4)', section: 'stsm' }
  ];

  async function onSetFormat(format: (typeof formats)[number]) {
    const [driveFormat, driveContainer] = format.id.split('-');
    await updateSettings({ driveFormat, driveContainer });
  }

  let { disabled = false, driveContainer, driveFormat, driveOptions, rewardTier }: Props = $props();

  let currentFormatId = $derived(`${driveFormat}-${driveContainer}`);
  let currentFormat = $derived(formats.find((f) => currentFormatId === f.id));
</script>

<button
  onclick={() => (showModal = true)}
  {disabled}
  class="flex cursor-pointer items-center justify-between rounded-md border border-neutral-200/25 px-3 py-2 text-left font-medium text-neutral-300 transition hover:bg-white/5 hover:text-neutral-200"
>
  <div class="flex h-10 items-center gap-2 sm:h-12">
    {#if currentFormat}
      <Icon icon={currentFormat.icon ?? sections.find((s) => s.id === currentFormat.section)!.icon} class="size-8 flex-none sm:size-10" />
      <div class="flex flex-col">
        <span class="text-xs text-neutral-400 sm:text-sm">{$t('cloud_backup.upload_format')}</span>
        <span class="text-lg/4 sm:text-xl/4">{convertT(currentFormat.text, $t)}</span>
        <span class="text-xs/4">{$t(`format_sections.${currentFormat.section}`)}</span>
      </div>
    {:else}
      <span class="text-lg sm:text-xl">{$t('cloud_backup.select_format')}…</span>
    {/if}
  </div>
  <Icon icon={rightIcon} class="size-6" />
</button>

{#if showModal}
  <Modal onclose={() => (showModal = false)} allowClose={!$savingSettings || !disabled}>
    <InnerModal title={$t('cloud_backup.select_format')}>
      {#each sections as section (section.id)}
        {@const sectionFormats = formats.filter((f) => f.section === section.id)}
        <div class="flex flex-col gap-2">
          <h3 class="font-medium text-zinc-300">{$t(`format_sections.${section.id}`)}</h3>
          {#if section.minTier && rewardTier !== -1 && (!rewardTier || rewardTier < section.minTier)}
            <RequiresTier minTier={section.minTier} />
          {:else}
            <div class="flex flex-wrap gap-2">
              {#each sectionFormats as format (format.id)}
                <FormatButton
                  icon={format.icon}
                  suffix={format.suffix}
                  selected={currentFormatId === format.id}
                  disabled={$savingSettings || disabled}
                  onclick={() => onSetFormat(format)}
                >
                  {convertT(format.text, $t)}
                </FormatButton>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      <hr class="border-white/20" />

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <SwitchField
            label={$t('cloud_backup.exclude_bots')}
            bind:checked={() => driveOptions?.excludeBots ?? false, (v) => updateSettings({ driveOptions: { excludeBots: v } })}
            disabled={$savingSettings || disabled}
            description={$t('cloud_backup.exclude_bots_desc')}
          />
        </div>
      </div>

      {#snippet buttons()}
        <Button disabled={$savingSettings || disabled} onclick={() => (showModal = false)}>
          <div class="relative">
            <span class="transition-opacity" class:opacity-0={$savingSettings || disabled}>
              {$t('common.close')}
            </span>
            <div
              class="pointer-events-none absolute bottom-0 left-0 right-0 top-0 flex scale-150 items-center justify-center transition-opacity"
              class:opacity-0={!$savingSettings || disabled}
              class:opacity-100={$savingSettings || disabled}
            >
              <Icon icon={loadingIcon} class="animate-spin" />
            </div>
          </div>
        </Button>
      {/snippet}
    </InnerModal>
  </Modal>
{/if}
