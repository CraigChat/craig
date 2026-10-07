<script lang="ts">
  import Icon from '@iconify/svelte';
  import outLinkIcon from '@iconify-icons/mdi/launch';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { persisted } from 'svelte-persisted-store';

  import { env } from '$env/dynamic/public';
  import type { StatusIncident } from '$lib/types';
  import { getRTF, relativeTime } from '$lib/util';

  const dismissedIncidents = persisted<string[]>('craig-maintenance-dismissed', []);

  let activeIncidents: StatusIncident[] = $state([]);
  let show = $state(false);

  onMount(async () => {
    if (!env.PUBLIC_STATUS_SITE) return;

    try {
      const response = await fetch(`${env.PUBLIC_STATUS_SITE}/api/planned-maintenance`);
      if (!response.ok) return [];
      const info: StatusIncident[] = await response.json();
      if (!info || !info.length) return;

      const maintenanceCutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
      activeIncidents = info.filter(
        (incident) =>
          !$dismissedIncidents.includes(incident.id) &&
          (incident.status === 'maintenance' ? Date.parse(incident.startedAt) <= maintenanceCutoff : incident.endedAt === null)
      );
      show = activeIncidents.length > 0;
    } catch {}
  });

  function dismissIncident(incidentId: string) {
    dismissedIncidents.update((current) => [...current, incidentId]);

    activeIncidents = activeIncidents.filter((incident) => !$dismissedIncidents.includes(incident.id));
    show = activeIncidents.length > 0;
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
  {#each activeIncidents as incident (incident.id)}
    {@const isMaintenance = incident.status === 'maintenance'}
    <div
      class={[
        'z-1 inline-flex flex-col items-center gap-2 rounded-2xl bg-linear-to-t from-zinc-900 px-4 py-2 shadow-section ring-2 sm:flex-row sm:justify-between',
        isMaintenance ? 'to-blue-950 ring-blue-600' : 'to-red-950 ring-red-600'
      ]}
    >
      <div class="text-center text-sm text-neutral-200 sm:text-left sm:text-base">
        <div class="font-semibold text-neutral-200">{incident.title} — {formatRelativeTime(incident.startedAt)}</div>
        {#if incident.comments.length > 0}
          <div class={['mt-1 text-xs', isMaintenance ? 'text-blue-200' : 'text-red-200']}>
            {incident.comments[0].message.split('\n')[0]}
          </div>
        {/if}
      </div>
      <div class="flex justify-end gap-1 text-xs font-medium text-white sm:text-sm">
        <a
          href="{env.PUBLIC_STATUS_SITE}/incidents/{incident.id}"
          target="_blank"
          class={[
            'flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 transition-all active:opacity-75',
            isMaintenance ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
          ]}
        >
          <span>{$t('maintenance.status_page')}</span>
          <Icon icon={outLinkIcon} class="flex-none" />
        </a>
        <button class="rounded-md px-2 py-1 transition-all hover:bg-white/10 active:opacity-75" onclick={() => dismissIncident(incident.id)}>
          {$t('common.dismiss')}
        </button>
      </div>
    </div>
  {/each}
{/if}
