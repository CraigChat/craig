<script lang="ts">
  import Icon from '@iconify/svelte';
  import outLinkIcon from '@iconify-icons/mdi/launch';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { persisted } from 'svelte-persisted-store';

  import { env } from '$env/dynamic/public';
  import type { StatusIncident } from '$lib/types';
  import { getRTF, relativeTime } from '$lib/util';

  const dismissedMaintenance = persisted<string[]>('craig-maintenance-dismissed', []);

  let activeMaintenance: StatusIncident[] = $state([]);
  let show = $state(false);

  onMount(async () => {
    if (!env.PUBLIC_STATUS_SITE) return;

    try {
      const response = await fetch(`${env.PUBLIC_STATUS_SITE}/api/planned-maintenance`);
      if (!response.ok) return [];
      const info: StatusIncident[] = await response.json();
      if (!info || !info.length) return;

      activeMaintenance = info.filter((maintenance) => maintenance.status === 'maintenance' && !$dismissedMaintenance.includes(maintenance.id));
      show = activeMaintenance.length > 0;
    } catch {}
  });

  function dismissMaintenance(maintenanceId: string) {
    dismissedMaintenance.update((current) => ({
      ...current,
      [maintenanceId]: true
    }));

    activeMaintenance = activeMaintenance.filter(
      (maintenance) => maintenance.status === 'maintenance' && !$dismissedMaintenance.includes(maintenance.id)
    );
    show = activeMaintenance.length > 0;
  }

  function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((date.getTime() - now.getTime()) / 1000);
    const rtf = getRTF();
    return relativeTime(rtf, seconds);
  }
</script>

{#if show}
  {#each activeMaintenance as maintenance}
    <div
      class="shadow-section z-[1] inline-flex flex-col items-center gap-2 rounded-2xl bg-gradient-to-t from-zinc-900 to-blue-950 px-4 py-2 ring-2 ring-blue-600 sm:flex-row sm:justify-between"
    >
      <div class="text-center text-sm text-neutral-200 sm:text-left sm:text-base">
        <div class="font-semibold text-neutral-200">{maintenance.title} — {formatRelativeTime(maintenance.startedAt)}</div>
        {#if maintenance.comments.length > 0}
          <div class="mt-1 text-xs text-blue-200">
            {maintenance.comments[0].message.split('\n')[0]}
          </div>
        {/if}
      </div>
      <div class="flex justify-end gap-1 text-xs font-medium text-white sm:text-sm">
        <a
          href="{env.PUBLIC_STATUS_SITE}/incidents/{maintenance.id}"
          target="_blank"
          class="flex items-center gap-1 whitespace-nowrap rounded-md bg-blue-600 px-2 py-1 transition-all hover:bg-blue-700 active:opacity-75"
        >
          <span>Status Page</span>
          <Icon icon={outLinkIcon} class="flex-none" />
        </a>
        <button class="rounded-md px-2 py-1 transition-all hover:bg-white/10 active:opacity-75" onclick={() => dismissMaintenance(maintenance.id)}>
          {$t('common.dismiss')}
        </button>
      </div>
    </div>
  {/each}
{/if}
