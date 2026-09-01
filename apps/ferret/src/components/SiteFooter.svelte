<script>
  import { t } from 'svelte-i18n';

  import { version } from '$app/environment';
</script>

<footer class="z-[1] inline-flex items-center text-xs sm:text-sm">
  <div class="w-full pb-5">
    <p>{$t('footer.build')} <code>{version.slice(0, 7)}</code></p>
    <hr class="my-2 border-white/25" />
    <div>
      <a href="https://craig.chat/privacy" class="underline underline-offset-2 transition-colors hover:text-white">{$t('footer.privacy')}</a>
      •
      <a href="https://craig.chat/terms" class="underline underline-offset-2 transition-colors hover:text-white">{$t('footer.tos')}</a>
    </div>
  </div>
</footer>
