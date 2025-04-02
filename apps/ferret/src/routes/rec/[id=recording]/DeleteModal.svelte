<script lang="ts">
  import Icon from '@iconify/svelte';
  import errorIcon from '@iconify-icons/mdi/error';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import Button from '$components/Button.svelte';
  import Modal from '$components/Modal.svelte';
  import { loadingIcon } from '$lib/icons';
  import { jobOpen } from '$lib/recording/data';
  import { APIErrorCode, type APIErrorResponse } from '$lib/types';

  const recording = page.data.recording!;
  const key = page.data.key!;

  interface Props {
    onclose?: () => void;
    onsetclosable?: (value: boolean) => void;
    deletekey: string;
  }

  let { onclose, onsetclosable, deletekey = $bindable() }: Props = $props();
  let deleting = $state(false);
  let responseError: APIErrorCode | null = $state(null);
  let keyInvalid = $state(false);

  async function deleteRecording() {
    if ($jobOpen) return;
    deleting = true;
    keyInvalid = false;
    onsetclosable?.(false);
    try {
      const response = await fetch(`/api/v1/recordings/${recording.id}?key=${key}&delete=${deletekey}`, {
        method: 'DELETE'
      }).catch(() => null);
      if (!response) return;
      if (!response.ok) {
        const err: APIErrorResponse = await response.json().catch(() => null);
        responseError = err?.code ?? APIErrorCode.SERVER_ERROR;
        if (responseError === APIErrorCode.INVALID_DELETE_KEY) {
          responseError = null;
          keyInvalid = true;
        }
      } else location.reload();
    } catch (e) {}
    onsetclosable?.(true);
    deleting = false;
  }
</script>

<Modal title={$t('recording.delete_modal.header')} subtitle={$t('recording.delete_modal.subtext')}>
  {#if responseError}
    <div class="flex items-center gap-2 rounded bg-red-600 p-2 text-xs text-white md:text-sm">
      <Icon icon={errorIcon} class="h-6 w-6 flex-none" />
      <p>{$t(`errors.${responseError}`)}</p>
    </div>
  {/if}

  <div class="flex flex-col gap-1 self-stretch">
    <label for="delete-key" class="font-display text-sm text-white sm:text-base">
      {$t('recording.delete_modal.delete_key')}
    </label>
    <input
      class="peer rounded-md border-2 border-zinc-700 bg-zinc-800 px-2 py-1 outline-none transition-colors placeholder:text-zinc-500 focus:border-teal-500 active:border-teal-400 data-[errored]:border-red-600"
      type="text"
      data-errored={keyInvalid ? 'true' : undefined}
      placeholder="123456789"
      oninput={() => (keyInvalid = false)}
      bind:value={deletekey}
    />
    <span class="text-xs peer-data-[errored]:text-red-500 sm:text-sm">
      {$t(keyInvalid ? 'recording.delete_modal.delete_key_invalid' : 'recording.delete_modal.delete_key_hint')}
    </span>
  </div>

  {#snippet buttons()}
    <Button disabled={deleting} onclick={onclose}>
      {$t('common.nevermind')}
    </Button>
    <Button bigdanger disabled={deletekey.length < 6 || deleting} onclick={deleteRecording}>
      <div class="relative">
        <span class="transition-opacity" class:opacity-0={deleting}>{$t('recording.delete_modal.confirm')}</span>
        <div
          class="absolute bottom-0 left-0 right-0 top-0 flex scale-150 items-center justify-center transition-opacity"
          class:opacity-0={!deleting}
          class:opacity-100={deleting}
        >
          <Icon icon={loadingIcon} class="animate-spin" />
        </div>
      </div>
    </Button>
  {/snippet}
</Modal>
