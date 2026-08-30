<script lang="ts">
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import { toast } from '$lib/toaster';
  import { currentTime, formatMilliseconds } from '$lib/util';

  const recording = page.data.recording!;
  const key = page.data.key!;
  const live = page.data.live;

  const startTimeSeconds = Math.floor(new Date(recording.startTime).valueOf() / 1000);
  let elapsedMs = $derived(($currentTime - startTimeSeconds) * 1000);

  async function onClick() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(`/api/v1/recordings/${recording.id}/duration?key=${key}`);
      const data: { duration: number } = await response.json().catch(() => null);
      if (!data.duration) return;
      duration = data.duration;
    } catch (e) {
      toast.error($t('errors.generic.duration'));
    }
    loading = false;
  }

  let loading = $state(false);
  let duration: number | undefined = $state(page.data.duration ?? undefined);
</script>

{#if live}
  <div class="inline-flex items-center gap-2">
    <span class="inline-flex items-center gap-1.5 rounded-full bg-red-600/25 px-2.5 py-1 text-xs font-medium text-white sm:text-base">
      <span class="relative inline-flex size-3 animate-pulse rounded-full bg-red-500 sm:size-4"></span>
      {$t('recording.rec')}
    </span>
    <span class="font-sans text-base font-normal text-neutral-400 sm:text-lg">{formatMilliseconds(elapsedMs, 2)}</span>
  </div>
{:else if !duration}
  <button
    class="rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium transition-all enabled:hover:bg-zinc-700 enabled:active:opacity-75 disabled:animate-pulse sm:text-sm"
    disabled={loading}
    onclick={onClick}
  >
    {#if loading}
      {$t('common.loading')}
    {:else}
      {$t('recording.reveal_duration')}
    {/if}
  </button>
{:else}
  <span class="font-sans text-base font-normal sm:text-lg">{formatMilliseconds(duration * 1000, 3)}</span>
{/if}
