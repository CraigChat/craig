<script>
  import Icon from '@iconify/svelte';
  import flaskIcon from '@iconify-icons/mdi/flask';
  import { t } from 'svelte-i18n';

  import { version } from '$app/environment';
  import { SUPPORT_SERVER_URL } from '$lib/util';

  import DynamicTranslatable from './DynamicTranslatable.svelte';
</script>

{#snippet supportServerLink()}
  <a href={SUPPORT_SERVER_URL} target="_blank" class="underline underline-offset-2 transition-colors hover:text-blue-300">
    {$t('footer.support_server')}
  </a>
{/snippet}

<footer class="z-[1] inline-flex items-center text-xs sm:text-sm">
  <div class="w-full pb-5">
    <p>{$t('footer.build')} <code>{version.slice(0, 7)}</code></p>
    <p class="text-blue-500">
      <span class="inline-block"><Icon icon={flaskIcon} class="translate-y-[0.125em]" /></span>
      <span>
        <DynamicTranslatable template={$t('footer.beta')} replacements={{ support_server: supportServerLink }} />
      </span>
    </p>
    <hr class="my-2 border-white/25" />
    <div>
      <a href="https://craig.chat/privacy" class="underline underline-offset-2 transition-colors hover:text-white">{$t('footer.privacy')}</a>
      •
      <a href="https://craig.chat/terms" class="underline underline-offset-2 transition-colors hover:text-white">{$t('footer.tos')}</a>
    </div>
  </div>
</footer>
