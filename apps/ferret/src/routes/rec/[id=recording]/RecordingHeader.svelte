<script lang="ts">
  import clsx from 'clsx';
  import type { APIApplication } from 'discord-api-types/v10';
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { locale, t } from 'svelte-i18n';
  import Portal from 'svelte-portal';

  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import DynamicTranslatable from '$components/DynamicTranslatable.svelte';
  import FallbackImage from '$components/FallbackImage.svelte';
  import RecordingUserChip from '$components/RecordingUserChip.svelte';
  import { jobOpen } from '$lib/recording/data';
  import { acronym, currentTime, getAvatar, getDefaultAvatar, getRTF, relativeTime } from '$lib/util';

  import DeleteModal from './DeleteModal.svelte';
  import DurationTag from './DurationTag.svelte';

  const recording = page.data.recording!;
  const users = page.data.users!;

  const EXPIRY_WARN_AT = 60 * 60 * 24;

  // FIX invalid locale breaks this
  let intlRtf = $derived(getRTF($locale ?? undefined, { numeric: 'auto' }));
  let startTime = new Date(recording.startTime);
  let expiryDate = new Date(startTime.valueOf() + 1000 * 60 * 60 * (recording.expiresAfter || 24));
  let expiry = $derived(Math.floor(expiryDate.valueOf() / 1000) - $currentTime);

  let guildIconURL: string | undefined = $state(recording.guild.icon);

  let botApplication: APIApplication | undefined = $state();
  async function getClientInfo(clientId: string) {
    const response = await fetch(`https://discord.com/api/v10/applications/${clientId}/rpc`).catch(() => null);
    if (!response || !response.ok) return;
    const clientInfo: APIApplication = await response.json().catch(() => null);
    if (!clientInfo) return;
    botApplication = clientInfo;
  }

  let deleteKey = $state(page.data.deleteKey ?? '');
  let showDeleteModal = $state(!!page.data.deleteKey);
  let allowModalClosing = $state(true);
  $effect(() => {
    if (!showDeleteModal && location.search.includes('delete=')) {
      const url = new URL(location.href);
      url.searchParams.delete('delete');
      replaceState(url.toString(), {});
    }
  });
  function onModalClick(this: any, e: any) {
    if (e.target === this && allowModalClosing) showDeleteModal = false;
  }

  onMount(() => {
    if (recording.client.id) getClientInfo(recording.client.id);
  });
</script>

<svelte:head>
  {#if recording.guild.icon}
    <link rel="preload" as="image" href={recording.guild.icon} />
  {/if}
  {#each users.filter((u) => u.avatarUrl) as user}
    <link rel="preload" as="image" href={user.avatarUrl} />
  {/each}
</svelte:head>

{#snippet channel()}
  <div class="flex items-center justify-center gap-1 font-semibold text-neutral-400 sm:gap-2">
    <div class="relative h-4 w-4 sm:h-6 sm:w-6">
      {#if recording.channel.type === 2}
        <svg viewBox="0 0 13 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-full w-full">
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M6.25533 0.0505271C6.006 -0.0521396 5.71933 0.00452707 5.52867 0.195194L2.66667 3.33253H0.666667C0.3 3.33253 0 3.63319 0 3.99919V7.99917C0 8.36583 0.3 8.66583 0.666667 8.66583H2.66667L5.52867 11.8045C5.71933 11.9952 6.006 12.0525 6.25533 11.9492C6.50467 11.8458 6.66667 11.6025 6.66667 11.3325V0.66586C6.66667 0.397194 6.50467 0.152527 6.25533 0.0505271ZM8 1.33247V2.6658C9.838 2.6658 11.3333 4.1618 11.3333 5.99917C11.3333 7.83717 9.838 9.3325 8 9.3325V10.6658C10.5733 10.6658 12.6667 8.57317 12.6667 5.99917C12.6667 3.42647 10.5733 1.33247 8 1.33247ZM8 3.99913C9.10267 3.99913 10 4.89717 10 5.99917C10 7.1025 9.10267 7.99917 8 7.99917V6.66583C8.36733 6.66583 8.66667 6.3665 8.66667 5.99917C8.66667 5.63183 8.36733 5.3325 8 5.3325V3.99913Z"
            fill="currentColor"
          />
        </svg>
      {:else if recording.channel.type === 13}
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-full w-full">
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M14 13C14 14.1 13.1 15 12 15C10.9 15 10 14.1 10 13C10 11.9 10.9 11 12 11C13.1 11 14 11.9 14 13ZM8.5 20V19.5C8.5 17.8 9.94 16.5 12 16.5C14.06 16.5 15.5 17.8 15.5 19.5V20H8.5ZM7 13C7 10.24 9.24 8 12 8C14.76 8 17 10.24 17 13C17 13.91 16.74 14.75 16.31 15.49L17.62 16.25C18.17 15.29 18.5 14.19 18.5 13C18.5 9.42 15.58 6.5 12 6.5C8.42 6.5 5.5 9.42 5.5 13C5.5 14.18 5.82 15.29 6.38 16.25L7.69 15.49C7.26 14.75 7 13.91 7 13ZM2.5 13C2.5 7.75 6.75 3.5 12 3.5C17.25 3.5 21.5 7.75 21.5 13C21.5 14.73 21.03 16.35 20.22 17.75L21.51 18.5C22.45 16.88 23 15 23 13C23 6.93 18.07 2 12 2C5.93 2 1 6.93 1 13C1 15 1.55 16.88 2.48 18.49L3.77 17.74C2.97 16.35 2.5 14.73 2.5 13Z"
            fill="currentColor"
          />
        </svg>
      {/if}
    </div>
    <div class="font-display text-base text-neutral-400 sm:text-xl">{recording.channel.name}</div>
  </div>
{/snippet}

{#snippet botApp()}
  <FallbackImage
    class="h-4 w-4 rounded-full bg-black/20"
    alt={botApplication!.name}
    src={botApplication!.icon
      ? `https://cdn.discordapp.com/app-icons/${botApplication!.id}/${botApplication!.icon}.png?size=64`
      : 'https://cdn.discordapp.com/embed/avatars/0.png'}
    fallbackSrc="https://cdn.discordapp.com/embed/avatars/0.png"
  />
  <div class="text-zinc-500">{botApplication!.name}</div>
{/snippet}

{#snippet requester()}
  <FallbackImage
    class="h-4 w-4 rounded-full bg-black/20 sm:h-6 sm:w-6"
    src={getAvatar(recording.requester)}
    alt={recording.requester.username}
    fallbackSrc={getDefaultAvatar(recording.requester)}
  />
  <div class="flex items-center justify-center">
    <div class="font-semibold">
      {recording.requester.username}
      {#if recording.requester.discriminator !== '0'}
        <span class="text-xs text-neutral-500">#{recording.requester.discriminator}</span>
      {/if}
    </div>
  </div>
{/snippet}

<div class="shadow-section z-[1] inline-flex flex-col items-start justify-start rounded-2xl bg-zinc-900">
  <div class="inline-flex w-full flex-col items-center justify-center gap-3 px-6 pb-1 pt-4 text-left sm:flex-row sm:gap-6 sm:pb-4 sm:text-center">
    <div
      class="relative flex h-28 w-28 select-none items-center justify-center gap-2.5 overflow-hidden rounded-2xl border-4 border-zinc-800 bg-zinc-800 shadow-lg"
    >
      {#if !guildIconURL}
        <span class="font-display text-2xl">{acronym(recording.guild.name)}</span>
      {:else}
        <img class="shrink grow basis-0 self-stretch" src={guildIconURL} alt={recording.guild.name} onerror={() => (guildIconURL = undefined)} />
      {/if}
    </div>
    <div class="inline-flex shrink grow basis-0 flex-col items-center justify-center gap-1.5 sm:items-start">
      <div class="flex flex-col items-center justify-center sm:items-start">
        <div class="font-display text-center text-xl font-semibold text-zinc-100 sm:text-left sm:text-2xl">{recording.guild.name}</div>
        <div
          class="inline-flex w-full flex-wrap items-center justify-center gap-1 text-base font-medium sm:items-start sm:justify-start sm:gap-2 sm:text-xl"
        >
          {#if $t('recording.by_user').includes('{channel}')}
            <DynamicTranslatable template={$t('recording.by_user')} replacements={{ user: requester, channel }} />
          {:else}
            {@render channel()}
            <div class="flex items-center justify-center gap-1 text-base font-medium text-neutral-400 sm:gap-2 sm:text-xl">
              <DynamicTranslatable template={$t('recording.by_user')} replacements={{ user: requester }} />
            </div>
          {/if}
        </div>
      </div>
      <div class="inline-flex w-full flex-wrap items-center justify-center gap-1 text-zinc-500 sm:justify-start">
        <div class="text-center text-xs font-medium">
          {$t('recording.recording_date', { values: { date: startTime } })}
          • {relativeTime(intlRtf, Math.min(0, startTime.valueOf() / 1000 - $currentTime))}
        </div>
        {#if botApplication}
          <div class="flex items-center justify-center gap-1 text-xs font-medium">
            <DynamicTranslatable template={$t('recording.via_bot')} replacements={{ bot: botApp }} />
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="flex w-full flex-col sm:flex-row">
    <div class="flex w-full flex-col gap-2 px-6 py-4 sm:flex-row sm:gap-4">
      <div class="inline-flex flex-1 items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-center">
        <div class="font-display text-base font-semibold text-neutral-300 sm:text-xl">{$t('recording.recording_id')}</div>
        <code class="select-all text-sm font-normal sm:text-base">{recording.id}</code>
      </div>
      <div class="inline-flex flex-1 items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-center">
        <div class={clsx('font-display text-base font-semibold sm:text-xl', expiry < EXPIRY_WARN_AT ? 'text-red-400' : 'text-neutral-300')}>
          {#if expiry <= 0}
            {$t('recording.expires_soon')}
          {:else}
            {$t('recording.expires_in', { values: { expiry: relativeTime(intlRtf, Math.max(0, expiry)) } })}
          {/if}
        </div>
        <button
          class="text-right text-sm font-normal underline underline-offset-2 transition-all hover:text-red-500 disabled:pointer-events-none disabled:opacity-50 sm:text-left sm:text-base"
          onclick={() => (showDeleteModal = true)}
          disabled={$jobOpen}
        >
          {$t('recording.delete')}
        </button>
      </div>
    </div>
  </div>
  <div class="inline-flex w-full flex-col items-center justify-center gap-2 px-6 pb-4 pt-1 sm:items-start sm:pt-4">
    <div class="font-display flex w-full justify-between gap-2 text-center text-base font-semibold text-neutral-300 sm:text-xl">
      <span>
        {$t('recording.users_recorded', { values: { count: users.length } })}
      </span>
      <DurationTag />
    </div>
    <div class="flex flex-wrap items-center justify-center gap-4 sm:justify-start">
      {#each users as user}
        <RecordingUserChip {user} />
      {/each}
    </div>
  </div>
</div>

{#if showDeleteModal}
  <Portal target="body">
    <div
      transition:fade={{ duration: 100 }}
      class="fixed bottom-0 left-0 right-0 top-0 z-30 flex select-none items-end justify-center bg-black/40 backdrop-blur-sm md:items-center md:px-8"
      aria-hidden="true"
      onclick={onModalClick}
    >
      <div
        transition:fly={{ duration: 250, y: 32 }}
        class="relative inline-flex max-h-[calc(100svh-6rem)] w-[1024px] flex-col items-start justify-start overflow-hidden rounded-t-lg bg-zinc-900 text-neutral-300 shadow-lg ring-2 ring-red-950/25 md:rounded-b-lg"
      >
        <div class="absolute left-0 right-0 top-0 z-0 h-40 max-h-[75%] bg-gradient-to-b from-red-600 to-transparent opacity-25"></div>
        <DeleteModal onsetclosable={(v) => (allowModalClosing = v)} onclose={() => (showDeleteModal = false)} bind:deletekey={deleteKey} />
      </div>
    </div>
  </Portal>
{/if}
