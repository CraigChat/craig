<script lang="ts">
  import Icon from '@iconify/svelte';
  import checkIcon from '@iconify-icons/mdi/check';
  import xIcon from '@iconify-icons/mdi/close';
  import starIcon from '@iconify-icons/mdi/star';
  import patreonIcon from '@iconify-icons/simple-icons/patreon';
  import type { APIUser } from 'discord-api-types/v10';
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { toast } from 'svelte-sonner';

  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import DynamicTranslatable from '$components/DynamicTranslatable.svelte';
  import Footer from '$components/Footer.svelte';
  import RequiresTier from '$components/RequiresTier.svelte';
  import SwitchField from '$components/SwitchField.svelte';
  import { env } from '$env/dynamic/public';
  import { PATREON_OAUTH_URL } from '$lib/oauth';
  import { APIErrorCode, type APIErrorResponse } from '$lib/types';
  import { CDNEndpoints, cn, getAvatar } from '$lib/util';

  import type { PageProps } from './$types';
  import CloudUploadFormat from './CloudUploadFormat.svelte';
  import CloudUploadService from './CloudUploadService.svelte';
  import DisconnectPatreonButton from './DisconnectPatreonButton.svelte';

  let { data }: PageProps = $props();
  const user: APIUser & { banner_color?: string | null } = data.user;
  const avatarDecorationAsset = $derived(user?.avatar_decoration_data?.asset);
  const primaryGuild = $derived(user?.primary_guild);
  const tier = $derived(data.data.rewardTier);
  const bestEntitlement = $derived(data.entitlements[0]);
  const patreon = $derived(data.connections.patreon);
  const responseQuery = $derived(page.url.searchParams.get('r'));
  const errorQuery = $derived(page.url.searchParams.get('error'));
  const fromQuery = $derived(page.url.searchParams.get('from'));

  const services: Record<string, string> = {
    google: 'Google',
    dropbox: 'Dropbox',
    microsoft: 'Microsoft',
    patreon: 'Patreon',
    box: 'Box'
  };

  let loading = $state(false);

  async function setSettings(body: any) {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(() => null);
      if (!response) return;
      if (!response.ok) {
        const err: APIErrorResponse = await response.json().catch(() => null);
        const responseError = err?.code ?? APIErrorCode.SERVER_ERROR;
        toast.error(`${$t(`cloud_backup.settings_error`)}: ${$t(`errors.${responseError}`)}`);
      } else await invalidateAll();
    } catch (e) {}
    loading = false;
  }

  onMount(async () => {
    await tick();
    if (responseQuery || errorQuery || fromQuery) {
      const url = new URL(location.href);
      url.searchParams.delete('r');
      url.searchParams.delete('error');
      url.searchParams.delete('from');
      replaceState(url.toString(), {});
    }
  });
</script>

{#snippet supportServer()}
  <a href="https://discord.gg/craig" target="_blank" class="text-blue-400 hover:underline">support server</a>
{/snippet}

{#if user.banner_color}
  <div
    class="pointer-events-none absolute left-0 right-0 top-0 h-64 bg-gradient-to-b from-white to-transparent opacity-20"
    style={`--tw-gradient-from: ${user.banner_color}`}
  ></div>
{/if}

<section class="mx-auto flex w-full max-w-4xl flex-col p-2 sm:px-6">
  {#if user.banner}
    <img
      src="{CDNEndpoints.BANNER(user.id, user.banner)}?size=1024"
      alt="Banner"
      class="z-[1] h-24 rounded-lg object-cover object-center"
      style={user.banner_color ? `background-color: ${user.banner_color}` : undefined}
    />
  {:else}
    <div class="h-24 w-full rounded-lg bg-teal-300"></div>
  {/if}
  <div class="flex flex-col items-center gap-4 sm:flex-row sm:px-4 sm:py-2">
    <div class="relative z-[1] -mt-20 size-24 flex-none sm:-mt-6">
      <img src={getAvatar(data.user)} alt="Avatar" class="bg-background/50 size-full rounded-full backdrop-blur-lg" />
      {#if avatarDecorationAsset}
        <img
          src={CDNEndpoints.AVATAR_DECORATION(avatarDecorationAsset)}
          alt="avatar decoration"
          class="scale-120 pointer-events-none absolute top-0 h-full w-full select-none"
        />
      {/if}
    </div>
    <div class="flex w-full flex-1 flex-col">
      <h2 class="flex w-full items-center text-lg font-medium leading-none text-white sm:text-2xl">
        <span class="overflow-hidden text-ellipsis">{user.global_name}</span>
        {#if primaryGuild?.identity_enabled && primaryGuild?.identity_guild_id && primaryGuild?.badge}
          <div class="ml-2 flex flex-none gap-0.5 rounded bg-neutral-600/50 px-1 py-0.5 text-xs font-bold">
            <img
              src={CDNEndpoints.CLAN_BADGE(primaryGuild.identity_guild_id, primaryGuild.badge) + '?size=16'}
              alt="clan badge"
              class="size-4"
              style:image-rendering="pixelated"
            />
            <span>{primaryGuild.tag}</span>
          </div>
        {/if}
      </h2>
      <span>{user.username}</span>
    </div>
    <a class="cursor-pointer self-start font-medium text-neutral-200 transition hover:text-red-500 hover:underline sm:self-center" href="/api/logout">
      {$t('common.logout')}
    </a>
  </div>
</section>

<!-- TODO show expiry on entitlements -->
<section class="mx-auto mt-4 flex w-full max-w-4xl flex-col gap-2 p-2 sm:px-6">
  {#if responseQuery}
    <div class="mb-4 flex flex-col items-center gap-2 rounded-lg border-2 border-green-600 bg-green-500/25 p-4 text-center text-white sm:flex-row">
      <Icon icon={checkIcon} class="size-6" />
      <span>{$t(`connection_responses.${responseQuery}`, { values: { service: services[fromQuery!] ?? '<unknown>' } })}</span>
    </div>
  {:else if errorQuery}
    <div class="mb-4 flex flex-col items-center gap-2 rounded-lg border-2 border-red-600 bg-red-500/25 p-4 text-center text-white sm:flex-row">
      <Icon icon={xIcon} class="size-6" />
      <b>{$t('connection_responses.connect_failed', { values: { service: services[fromQuery!] ?? '<unknown>' } })}</b>
      <span
        >{errorQuery?.startsWith('__')
          ? $t(`connection_errors.${errorQuery.slice(2)}`, { values: { service: services[fromQuery!] ?? '<unknown>' } })
          : errorQuery}</span
      >
    </div>
  {/if}

  <h2 class="mb-2 text-xl font-bold text-white sm:text-2xl">{$t('headers.supporter_status')}</h2>
  <div
    class={cn('flex flex-col items-center justify-between rounded-lg border-2 border-neutral-600/25 p-4 sm:flex-row', {
      'border-amber-500/25 bg-amber-600/10 text-amber-500': tier === 10,
      'border-pink-500/25 bg-pink-600/10 text-pink-500': tier === 20,
      'border-teal-500/25 bg-teal-600/10 text-teal-500': tier === 30,
      'border-yellow-500/25 bg-yellow-600/10 text-yellow-500': tier === -1 || tier === 100
    })}
  >
    <div class="flex items-center gap-2">
      {#if tier !== 0}
        <Icon icon={starIcon} class="size-6" />
      {/if}
      <span class="sm:text-lg">{$t(`supporter_tiers.${tier}`, { default: `Unknown Tier (${tier})` })}</span>
    </div>
    {#if tier === 0 && env.PUBLIC_PATREON_URL}
      <a
        class="flex items-center gap-1 font-medium text-neutral-200 decoration-teal-500 transition hover:text-white hover:underline"
        href="https://patreon.com/{env.PUBLIC_PATREON_URL}"
        target="_blank"
      >
        <Icon icon={starIcon} class="size-5 text-teal-500" />
        <span>{$t('supporter_status.cta')}</span>
      </a>
    {:else if bestEntitlement?.source === 'patreon' && env.PUBLIC_PATREON_URL}
      <a
        class="font-medium text-neutral-200 decoration-teal-500 transition hover:text-white hover:underline"
        href="https://www.patreon.com/settings/memberships/{env.PUBLIC_PATREON_URL}"
        target="_blank"
      >
        {$t('supporter_status.manage')}
      </a>
    {:else if bestEntitlement?.source === 'developer'}
      <span class="text-neutral-400">{$t('supporter_status.dev_tier')}</span>
    {/if}
  </div>

  {#if env.PUBLIC_PATREON_CLIENT_ID}
    <div class="flex flex-col items-center justify-between gap-2 rounded-lg border-2 border-neutral-600 bg-black/25 p-4 text-white sm:flex-row">
      <div class="flex items-center gap-2">
        <Icon icon={patreonIcon} class="size-6 sm:size-8" />
        <div class="flex flex-col items-start text-left">
          <span class="text-lg">Patreon</span>
          {#if patreon}
            <a
              class="-mt-1 text-xs font-medium text-neutral-200 decoration-teal-500 transition hover:text-white hover:underline"
              href="https://patreon.com/user/{patreon.id}"
              target="_blank"
            >
              {patreon.name ?? $t('common.profile')}
            </a>
          {/if}
        </div>
      </div>

      {#if patreon}
        <DisconnectPatreonButton />
      {:else}
        <a
          class="cursor-pointer rounded-md bg-teal-500/25 px-3 py-1 font-medium text-teal-500 transition hover:bg-teal-500/50 hover:text-white active:scale-[.98]"
          href={PATREON_OAUTH_URL}
        >
          {$t('common.connect')}
        </a>
      {/if}
    </div>
  {/if}

  {#if tier === 0}
    <h3 class="mb-2 mt-4 text-lg font-bold text-neutral-200 sm:text-xl">{$t('supporter_troubleshoot.header')}</h3>
    <span>
      {$t('supporter_troubleshoot.line_1')}
    </span>
    <span>
      {$t('supporter_troubleshoot.line_2')}
    </span>
    <span>
      <DynamicTranslatable template={$t('supporter_troubleshoot.line_3')} replacements={{ support_server: supportServer }} />
    </span>
  {/if}

  <h2 class="mb-2 mt-10 text-xl font-bold text-white sm:text-2xl">{$t('headers.cloud_backup')}</h2>
  {#if tier === 0}
    <RequiresTier minTier={10} />
  {:else}
    <SwitchField
      label={$t('cloud_backup.enable')}
      bind:checked={() => data.data.driveEnabled, (v) => setSettings({ driveEnabled: v })}
      disabled={loading}
      description={$t('cloud_backup.enable_desc')}
    />
    <CloudUploadService connections={data.connections} driveService={data.data.driveService as any} disabled={loading} />
    <CloudUploadFormat
      driveFormat={data.data.driveFormat}
      driveContainer={data.data.driveContainer}
      driveOptions={data.data.driveOptions}
      rewardTier={data.data.rewardTier}
      disabled={loading}
    />
  {/if}

  <Footer />
</section>
