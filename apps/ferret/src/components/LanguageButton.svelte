<script lang="ts">
  import Icon from '@iconify/svelte';
  import partialIcon from '@iconify-icons/mdi/alert-outline';
  import checkIcon from '@iconify-icons/mdi/check';
  import dropdownIcon from '@iconify-icons/mdi/chevron-down';
  import langIcon from '@iconify-icons/mdi/translate';
  import beFlag from '@iconify-icons/twemoji/flag-belarus';
  import frFlag from '@iconify-icons/twemoji/flag-france';
  import deFlag from '@iconify-icons/twemoji/flag-germany';
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

  const fullLocales = ['en', 'tr', 'nl'];

  const localeNames: Record<string, string> = {
    en: 'English',
    es: 'Español',
    ar: 'عربى',
    be: 'Беларускі',
    de: 'Deutsch',
    fr: 'Français',
    nl: 'Nederlands',
    ru: 'Русский',
    tok: 'Toki Pona',
    tr: 'Türkçe',
    uk: 'Український'
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
    tok: {
      width: 468,
      height: 617,
      body: `<g xmlns="http://www.w3.org/2000/svg" transform="translate(0,617) scale(0.709091,-0.709091)" fill="#000099" stroke="none">
        <path fill="#000099" stroke="none" d="M302 838 c-14 -14 -16 -126 -3 -147 5 -8 16 -11 25 -8 12 5 16 21 16 71 0 89 -10 112 -38 84z"/>
        <path fill="#000099" stroke="none" d="M521 775 c-27 -57 -32 -108 -10 -113 18 -3 84 122 75 144 -11 30 -44 15 -65 -31z"/>
        <path fill="#000099" stroke="none" d="M34 797 c-8 -22 59 -158 76 -154 38 7 -11 167 -51 167 -11 0 -22 -6 -25 -13z"/>
        <path fill="#000099" stroke="none" d="M254 590 c-50 -7 -128 -52 -175 -100 -98 -100 -65 -346 57 -423 63 -40 107 -50 200 -44 125 7 212 62 275 172 53 92 32 220 -51 317 -62 71 -170 99 -306 78z"/>
        <path fill="#ffff63" stroke="none" d="M443 539 c47 -13 112 -70 138 -120 24 -48 26 -147 3 -190 -22 -43 -82 -108 -117 -125 -137 -71 -277 -55 -351 41 -39 52 -51 92 -51 175 1 77 19 113 82 161 80 63 198 86 296 58z"/>
        <path fill="#000099" stroke="none" d="M462 367 c-5 -7 -15 -28 -21 -48 -21 -67 -100 -120 -144 -98 -30 15 -65 56 -88 102 -21 40 -51 48 -57 14 -5 -26 53 -111 96 -141 89 -62 204 -7 252 119 15 40 -15 81 -38 52z"/>
      </g>`
    }
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
