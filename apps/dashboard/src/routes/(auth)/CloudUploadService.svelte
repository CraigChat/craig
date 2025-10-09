<script lang="ts">
  import Icon from '@iconify/svelte';
  import boxIcon from '@iconify-icons/logos/box';
  import dropboxIcon from '@iconify-icons/logos/dropbox';
  import googleDriveIcon from '@iconify-icons/logos/google-drive';
  import onedriveIcon from '@iconify-icons/logos/microsoft-onedrive';
  import rightIcon from '@iconify-icons/mdi/chevron-right';
  import { t } from 'svelte-i18n';
  import { toast } from 'svelte-sonner';

  import { invalidateAll } from '$app/navigation';
  import Button from '$components/Button.svelte';
  import InnerModal from '$components/InnerModal.svelte';
  import Modal from '$components/Modal.svelte';
  import { updateSettings } from '$lib/data';
  import { loadingIcon } from '$lib/icons';
  import { BOX_OAUTH_URL, GOOGLE_OAUTH_URL, MICROSOFT_OAUTH_URL } from '$lib/oauth';
  import { APIErrorCode, type APIErrorResponse, type ConnectionsData } from '$lib/types';
  import { cn } from '$lib/util';

  let showModal = $state(false);
  let loading = $state(false);

  interface Props {
    disabled?: boolean;
    connections: ConnectionsData;
    driveService: (typeof services)[number]['id'];
  }

  const services = [
    {
      id: 'google',
      icon: googleDriveIcon,
      name: 'Google Drive',
      oauthUrl: GOOGLE_OAUTH_URL,
      settingsUrl: 'https://myaccount.google.com/connections',

      mainServiceName: 'Google'
    },
    {
      id: 'onedrive',
      icon: onedriveIcon,
      name: 'Microsoft OneDrive',
      oauthUrl: MICROSOFT_OAUTH_URL,
      settingsUrl: 'https://microsoft.com/consent',

      apiId: 'microsoft',
      mainServiceName: 'Microsoft'
    },
    {
      id: 'dropbox',
      icon: dropboxIcon,
      name: 'Dropbox',
      oauthUrl: '/api/connections/dropbox/connect',
      settingsUrl: 'https://www.dropbox.com/account/connected_apps'
    },
    {
      id: 'box',
      icon: boxIcon,
      name: 'Box',
      oauthUrl: BOX_OAUTH_URL,
      settingsUrl: 'https://app.box.com/integrations?myIntegrations=true'
    }
  ] as const;

  async function onDisconnect(serviceId: (typeof services)[number]['id']) {
    const service = services.find((s) => s.id === serviceId)!;
    loading = true;
    try {
      const response = await fetch(`/api/connections/${'apiId' in service ? service.apiId : serviceId}`, {
        method: 'DELETE'
      }).catch(() => null);
      if (!response) return;
      if (!response.ok) {
        const err: APIErrorResponse = await response.json().catch(() => null);
        const responseError = err?.code ?? APIErrorCode.SERVER_ERROR;
        toast.error(`Error disconnecting ${service.name}: ${$t(`errors.${responseError}`)}`);
      } else {
        await invalidateAll();
        const serviceName = 'mainServiceName' in service ? service.mainServiceName : service.name;
        toast.success($t('cloud_backup.disconnected_service', { values: { service: serviceName } }), {
          description: $t('cloud_backup.revoke_app_perms', { values: { service: serviceName } }),
          action: {
            label: $t('common.manage'),
            onClick: () => open(service.settingsUrl, '_blank')
          },
          duration: 30_000
        });
      }
    } catch (e) {}
    loading = false;
  }

  async function onSetService(serviceId: (typeof services)[number]['id']) {
    if (serviceId === driveService) return;
    loading = true;
    await updateSettings({ driveService: serviceId });
    loading = false;
  }

  let { disabled = false, connections, driveService }: Props = $props();
</script>

<button
  onclick={() => (showModal = true)}
  {disabled}
  class="flex cursor-pointer items-center justify-between rounded-md border border-neutral-200/25 px-3 py-2 text-left font-medium text-neutral-300 transition hover:bg-white/5 hover:text-neutral-200"
>
  <div class="flex h-10 items-center gap-2 sm:h-12">
    {#if driveService && connections[driveService]?.connected && services.find((s) => s.id === driveService)}
      {@const service = services.find((s) => s.id === driveService)!}
      <Icon icon={service.icon} class="size-8 flex-none sm:size-10" />
      <div class="flex flex-col">
        <span class="text-xs text-neutral-400 sm:text-sm">{$t('cloud_backup.upload_service')}</span>
        <span class="text-lg/4 sm:text-xl/4">{service.name}</span>
      </div>
    {:else}
      <span class="text-lg sm:text-xl">{$t('cloud_backup.select_service')}…</span>
    {/if}
  </div>
  <Icon icon={rightIcon} class="size-6" />
</button>

{#if showModal}
  <Modal onclose={() => (showModal = false)} allowClose={!loading || !disabled}>
    <InnerModal title={$t('cloud_backup.select_service')}>
      {#each services as service (service.id)}
        <div
          class="flex flex-col justify-between gap-2 rounded-md bg-zinc-800 px-3 py-2 text-left font-medium text-zinc-300 transition sm:flex-row sm:items-center"
        >
          <button class="group flex items-center gap-2" disabled={loading || disabled} onclick={() => onSetService(service.id)}>
            {#if connections[service.id]}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                class={cn('size-6 rounded-full bg-zinc-950 transition group-disabled:opacity-50', {
                  'bg-teal-600': service.id === driveService,
                  'group-enabled:cursor-pointer': service.id !== driveService
                })}
              >
                {#if service.id === driveService}
                  <path class="stroke-white" d="M7 13l3 3 7-7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                {:else}
                  <circle class="fill-transparent transition-colors group-enabled:group-hover:fill-zinc-500" cx="12" cy="12" r="6"></circle>
                {/if}
              </svg>
            {/if}
            <Icon icon={service.icon} class="size-8 flex-none" />
            <div class="flex flex-col items-start text-left">
              <span class="text-lg">{service.name}</span>
              {#if connections[service.id]?.name}
                <span class="-mt-1 text-xs text-zinc-400">{connections[service.id]?.name}</span>
              {/if}
            </div>
          </button>
          <div class="flex flex-col">
            {#if !connections[service.id]}
              <a
                class="cursor-pointer rounded-md bg-teal-500/25 px-3 py-1 text-center font-medium text-teal-500 transition hover:bg-teal-500/50 hover:text-white active:scale-[.98]"
                href={service.oauthUrl}
              >
                {$t('common.connect')}
              </a>
            {:else}
              <button
                {disabled}
                class="cursor-pointer px-3 py-1 font-medium text-neutral-200 transition hover:text-red-500 hover:underline disabled:opacity-50"
                onclick={() => onDisconnect(service.id)}
              >
                {$t('common.disconnect')}
              </button>
            {/if}
          </div>
        </div>
      {/each}

      {#snippet buttons()}
        <Button disabled={loading || disabled} onclick={() => (showModal = false)}>
          <div class="relative">
            <span class="transition-opacity" class:opacity-0={loading || disabled}>
              {$t('common.close')}
            </span>
            <div
              class="pointer-events-none absolute bottom-0 left-0 right-0 top-0 flex scale-150 items-center justify-center transition-opacity"
              class:opacity-0={!loading || disabled}
              class:opacity-100={loading || disabled}
            >
              <Icon icon={loadingIcon} class="animate-spin" />
            </div>
          </div>
        </Button>
      {/snippet}
    </InnerModal>
  </Modal>
{/if}
