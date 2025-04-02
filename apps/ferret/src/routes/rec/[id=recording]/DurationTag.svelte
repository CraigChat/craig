<script lang="ts">
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import { toast } from '$lib/toaster';
  import { formatMilliseconds } from '$lib/util';

  const recording = page.data.recording!;
  const key = page.data.key!;

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
  let duration: number | undefined = $state();
</script>

{#if !duration}
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
