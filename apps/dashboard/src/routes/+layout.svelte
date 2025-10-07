<script lang="ts">
  import '../app.css';
  import '@fontsource-variable/inter';

  import Icon from '@iconify/svelte';
  import reloadIcon from '@iconify-icons/mdi/reload';
  import { ProgressBar } from '@prgm/sveltekit-progress-bar';
  import { Tooltip } from 'bits-ui';
  import { onMount, type Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { Toaster } from 'svelte-sonner';

  import { onNavigate } from '$app/navigation';
  import { updated } from '$app/state';
  import Header from '$components/Header.svelte';
  import { env } from '$env/dynamic/public';

  let { children }: { children: Snippet } = $props();

  function pageview() {
    window.plausible?.('pageview', {
      u: `${location.origin}${location.pathname.replace(/\d{16,19}/g, ':id')}`
    });
  }

  onNavigate(pageview);
  onMount(pageview);
</script>

<svelte:head>
  <title>Craig Dashboard</title>
  <link rel="preload" as="font" type="font/ttf" crossorigin="anonymous" href="/assets/fonts/PublicSans-variable.ttf" />
  {#if env.PUBLIC_PLAUSIBLE_HOSTNAME}
    <script data-domain={env.PUBLIC_HOSTNAME} src="https://{env.PUBLIC_PLAUSIBLE_HOSTNAME}/js/script.manual.tagged-events.js"></script>
  {/if}
</svelte:head>

<ProgressBar class="text-teal-500" zIndex={100} />

<Tooltip.Provider delayDuration={200}>
  <Header />
  <main class="sm:pt-22 pt-12">
    {@render children?.()}
  </main>
</Tooltip.Provider>

{#if updated.current}
  <div class="fixed left-0 right-0 top-16 z-50 mx-auto flex w-full max-w-5xl flex-col gap-4 p-4" transition:fly={{ y: 10 }}>
    <button
      class="mx-auto flex w-full cursor-pointer items-center justify-center gap-1 rounded border border-blue-500 bg-blue-500/25 px-2 py-1 text-sm text-white shadow shadow-blue-600 backdrop-blur-md transition-colors hover:bg-blue-500/50 sm:text-base"
      onclick={() => location.reload()}
    >
      <Icon icon={reloadIcon} class="size-6" />
      <span>The site has been updated! Click to go to the new version.</span>
    </button>
  </div>
{/if}

<div class="z-50">
  <Toaster position="bottom-right" theme="dark" />
</div>
