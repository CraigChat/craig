<script lang="ts">
  import Icon from '@iconify/svelte';
  import { t } from 'svelte-i18n';
  import { toast } from 'svelte-sonner';

  import { invalidateAll } from '$app/navigation';
  import Button from '$components/Button.svelte';
  import InnerModal from '$components/InnerModal.svelte';
  import Modal from '$components/Modal.svelte';
  import { loadingIcon } from '$lib/icons';
  import { APIErrorCode, type APIErrorResponse } from '$lib/types';

  let showModal = $state(false);
  let disconnecting = $state(false);

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  async function disconnectPatreon() {
    disconnecting = true;
    try {
      const response = await fetch(`/api/connections/patreon`, {
        method: 'DELETE'
      }).catch(() => null);
      if (!response) return;
      if (!response.ok) {
        const err: APIErrorResponse = await response.json().catch(() => null);
        const responseError = err?.code ?? APIErrorCode.SERVER_ERROR;
        toast.error(`Error disconnecting Patreon: ${$t(`errors.${responseError}`)}`);
      } else {
        await invalidateAll();
        toast.success('Disconnected your Patreon account.');
        showModal = false;
      }
    } catch (e) {}
    disconnecting = false;
  }
</script>

<button
  onclick={() => (showModal = true)}
  {disabled}
  class="cursor-pointer font-medium text-neutral-200 transition hover:text-red-500 hover:underline disabled:opacity-50"
>
  Disconnect
</button>

{#if showModal}
  <Modal class="ring-red-950/25" onclose={() => (showModal = false)} allowClose={!disconnecting}>
    <div class="absolute left-0 right-0 top-0 z-0 h-40 max-h-[75%] bg-gradient-to-b from-red-600 to-transparent opacity-25"></div>
    <InnerModal title="Are you sure you want to disconnect your Patreon account?" class="z-[1]">
      <span>Your benefits may be revoked if you disconnect your Patreon account.</span>

      {#snippet buttons()}
        <Button disabled={disconnecting} onclick={() => (showModal = false)}>
          {$t('common.nevermind')}
        </Button>
        <Button bigdanger disabled={disconnecting} onclick={disconnectPatreon}>
          <div class="relative">
            <span class="transition-opacity" class:opacity-0={disconnecting}>
              {$t('common.disconnect')}
            </span>
            <div
              class="pointer-events-none absolute bottom-0 left-0 right-0 top-0 flex scale-150 items-center justify-center transition-opacity"
              class:opacity-0={!disconnecting}
              class:opacity-100={disconnecting}
            >
              <Icon icon={loadingIcon} class="animate-spin" />
            </div>
          </div>
        </Button>
      {/snippet}
    </InnerModal>
  </Modal>
{/if}
