<script lang="ts">
  import Icon from '@iconify/svelte';
  import partialIcon from '@iconify-icons/mdi/alert-outline';
  import checkIcon from '@iconify-icons/mdi/check';
  import dropdownIcon from '@iconify-icons/mdi/chevron-down';
  import langIcon from '@iconify-icons/mdi/translate';
  import beFlag from '@iconify-icons/twemoji/flag-belarus';
  import frFlag from '@iconify-icons/twemoji/flag-france';
  import deFlag from '@iconify-icons/twemoji/flag-germany';
  import jaFlag from '@iconify-icons/twemoji/flag-japan';
  import nlFlag from '@iconify-icons/twemoji/flag-netherlands';
  import ruFlag from '@iconify-icons/twemoji/flag-russia';
  import arFlag from '@iconify-icons/twemoji/flag-saudi-arabia';
  import esFlag from '@iconify-icons/twemoji/flag-spain';
  import trFlag from '@iconify-icons/twemoji/flag-turkey';
  import ukFlag from '@iconify-icons/twemoji/flag-ukraine';
  import enFlag from '@iconify-icons/twemoji/flag-united-states';
  import clsx from 'clsx';
  import { fade } from 'svelte/transition';
  import { createFloatingActions } from 'svelte-floating-ui';
  import { offset, shift } from 'svelte-floating-ui/dom';
  import { locale, locales, t } from 'svelte-i18n';
  import Portal from 'svelte-portal';

  import { localeCookieName } from '$lib/cookie';

  const fullLocales = ['en', 'tr', 'nl', 'ja'];

  const localeNames: Record<string, string> = {
    en: 'English',
    es: 'Español',
    ar: 'عربى',
    be: 'Беларускі',
    de: 'Deutsch',
    fr: 'Français',
    nl: 'Nederlands',
    ru: 'Русский',
    tr: 'Türkçe',
    uk: 'Український',
    ja: '日本語'
  };

  const localeFlags: Record<string, any> = {
    en: enFlag,
    es: esFlag,
    fr: frFlag,
    de: deFlag,
    ar: arFlag,
    be: beFlag,
    ru: ruFlag,
    tr: trFlag,
    uk: ukFlag,
    nl: nlFlag,
    ja: jaFlag
  };

  let wrapper = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();
  let popupOpen = $state(false);

  function mousedown({ target }: MouseEvent) {
    if (popupOpen && !wrapper!.contains(target as Node) && !button!.contains(target as Node)) popupOpen = false;
  }

  const [floatingRef, floatingContent] = createFloatingActions({
    strategy: 'absolute',
    placement: 'bottom-end',
    middleware: [offset(8), shift()]
  });
</script>

<svelte:window onmousedown={mousedown} />

<button
  class="flex items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors hover:bg-white/10 hover:text-white data-[open]:bg-white/10 data-[open]:text-white sm:text-base"
  use:floatingRef
  title={$t('common.language')}
  onclick={() => (popupOpen = true)}
  data-open={popupOpen ? '' : undefined}
  bind:this={button}
>
  <Icon icon={langIcon} />
  <span>{$t('name')}</span>
  <Icon icon={dropdownIcon} />
</button>

{#if popupOpen}
  <Portal target="body">
    <div
      bind:this={wrapper}
      use:floatingContent
      class="small-scrollbar z-50 flex max-h-40 flex-col gap-1 overflow-auto rounded-md bg-zinc-700 py-1 pl-1 text-zinc-300 shadow shadow-black"
      class:pr-1={$locales.length < 5}
      transition:fade={{ duration: 100 }}
    >
      {#each $locales as lang}
        {@const selected = $locale && (lang === $locale || $locale.split('-')[0] === lang)}
        <button
          class="flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-white/25 hover:text-white"
          onclick={() => {
            locale.set(lang);
            document.cookie = `${localeCookieName}=${lang}; SameSite=Lax; Path=/`;
          }}
        >
          {#if localeFlags[lang]}
            <Icon icon={localeFlags[lang]} class="w-6 flex-none scale-125" />
          {/if}
          <span class="flex-1 text-left">
            {localeNames[lang] || lang}
          </span>
          {#if !fullLocales.includes(lang) && !selected}
            <Icon icon={partialIcon} class="flex-none text-yellow-300/50" />
          {:else}
            <Icon
              icon={checkIcon}
              class={clsx('flex-none', {
                'text-white': selected,
                'text-transparent': !selected
              })}
            />
          {/if}
        </button>
      {/each}
    </div>
  </Portal>
{/if}

<style lang="scss">
  .small-scrollbar {
    &::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    &::-webkit-scrollbar-thumb {
      background-color: rgba(255, 255, 255, 0.25);
      border-radius: 10px;
      border: 2px solid #3f3f46;
    }
    &::-webkit-scrollbar-track {
      border-radius: 10px;
    }
  }
</style>
