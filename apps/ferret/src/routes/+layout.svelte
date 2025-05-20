<script lang="ts">
  import '@fontsource-variable/inter';
  import '@fontsource-variable/roboto-mono';
  import '../app.postcss';
  import '$lib/tooltip/styles.scss';

  import Icon from '@iconify/svelte';
  import reloadIcon from '@iconify-icons/mdi/reload';
  import { fly } from 'svelte/transition';

  import { page, updated } from '$app/state';
  import bgMask from '$assets/bgmask.svg';
  import { env } from '$env/dynamic/public';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();
</script>

<svelte:head>
  <title>Craig</title>
  <link rel="preload" as="font" type="font/ttf" crossorigin="anonymous" href="/assets/fonts/PublicSans-variable.ttf" />
  {#if env.PUBLIC_PLAUSIBLE_HOSTNAME}
    <script data-domain={env.PUBLIC_HOSTNAME} src="https://{env.PUBLIC_PLAUSIBLE_HOSTNAME}/js/script.manual.js"></script>
  {/if}
</svelte:head>

<div class="app">
  <main>
    <div class="pointer-events-none absolute flex h-full w-full justify-center overflow-hidden" aria-hidden="true">
      <div
        data-errored={page.error ? 'true' : undefined}
        class="-mt-20 data-[errored]:opacity-50 data-[errored]:grayscale"
        style:mask={`url("${bgMask}")`}
      >
        <enhanced:img src="$assets/bgwave.png" alt="BackgroundWave" aria-hidden="true" class="z-0 max-w-[unset]" />
      </div>
    </div>
    {@render children?.()}
  </main>

  {#if updated.current}
    <div class="fixed bottom-0 z-50 flex w-full flex-col gap-4 p-2 sm:gap-8 sm:p-6" transition:fly={{ y: 10 }}>
      <button
        class="mx-auto flex w-full max-w-3xl items-center justify-center gap-1 rounded border border-blue-500 bg-blue-500/25 px-2 py-1 text-sm text-white shadow shadow-blue-600 backdrop-blur-md transition-colors hover:bg-blue-500/50 sm:text-base"
        onclick={() => location.reload()}
      >
        <Icon icon={reloadIcon} class="h-8 w-8" />
        <span>The site has been updated! Click to go to the new version.</span>
      </button>
    </div>
  {/if}
</div>
