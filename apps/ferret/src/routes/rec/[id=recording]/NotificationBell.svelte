<script lang="ts">
  import type { Kitchen } from '@craig/types';
  import Icon from '@iconify/svelte';
  import bellOnIcon from '@iconify-icons/mdi/bell';
  import bellDisallowedIcon from '@iconify-icons/mdi/bell-off-outline';
  import bellIcon from '@iconify-icons/mdi/bell-outline';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import { jobNotify } from '$lib/data';
  import { tooltip } from '$lib/tooltip';
  import type { RecordingPageEmitter } from '$lib/types';

  const recording = page.data.recording!;
  interface Props {
    emitter: RecordingPageEmitter;
    visible?: boolean;
  }

  let { emitter, visible = true }: Props = $props();

  let accessPending = $state(false);
  let permission: null | boolean = $state(null);
  let unsupported = !('Notification' in window);
  let notifications = new Map<number, Notification>();

  function onStatusUpdate(status: Kitchen.JobStatus) {
    if (document.visibilityState === 'visible' || !$jobNotify || permission !== true) return;
    const text = `${$t(status === 'complete' ? 'notification.job.complete' : status === 'error' ? 'notification.job.error' : 'notification.job.cancelled')} (${recording.id})`;
    const id = Date.now() + Math.round(Math.random() * 1000);
    const notif = new Notification(text, {
      tag: `recording-${recording.id}-${status}`,
      body: $t('notification.body', { values: { guild: recording.guild.name } }),
      icon: '/craig.png',
      badge: '/favicon-16x16.png',
      requireInteraction: true
    });
    notifications.set(id, notif);
    notif.onerror = () => notifications.delete(id);
    notif.onclick = () => notifications.delete(id);
    notif.onclose = () => notifications.delete(id);
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    for (const notif of notifications.values()) notif.close();
    notifications.clear();
  }

  async function onClick() {
    if (accessPending || permission === false) return;

    if (permission === null) {
      accessPending = true;
      const result = await Notification.requestPermission();
      accessPending = false;
      if (result === 'denied') return void (permission = false);
      permission = true;
      $jobNotify = true;
      return;
    }

    $jobNotify = !$jobNotify;
  }

  onMount(() => {
    if (!unsupported) {
      if (Notification.permission === 'granted') permission = true;
      else if (Notification.permission === 'denied') permission = false;
    }
    emitter.on('statusUpdate', onStatusUpdate);
    return () => emitter.off('statusUpdate', onStatusUpdate);
  });
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />
{#if !unsupported && visible}
  <button
    class="hidden md:block"
    onclick={onClick}
    disabled={accessPending || permission === false}
    use:tooltip={{
      content: $t(
        permission === false ? 'notification.bell.unavailable' : permission && $jobNotify ? 'notification.bell.disable' : 'notification.bell.enable'
      ),
      placement: 'left',
      offset: 15,
      visibility: !accessPending
    }}
  >
    <Icon icon={permission === false ? bellDisallowedIcon : permission === true && $jobNotify ? bellOnIcon : bellIcon} class="h-6 w-6" />
  </button>
{/if}

<style lang="scss">
  button {
    @apply transition-all;

    &:hover:not(:disabled) {
      @apply text-neutral-200;
    }

    &:active {
      @apply scale-90;
    }

    &:disabled {
      @apply opacity-50;
    }
  }
</style>
