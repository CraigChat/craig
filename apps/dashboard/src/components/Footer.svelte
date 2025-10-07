<script>
  import { t } from 'svelte-i18n';
</script>

<footer class="z-[1] mt-10 w-full text-xs sm:text-sm">
  <hr class="my-2 border-white/25" />
  <div>
    <a href="https://craig.chat/privacy" class="font-medium text-neutral-200 transition-colors hover:text-white">{$t('footer.privacy')}</a>
    •
    <a href="https://craig.chat/terms" class="font-medium text-neutral-200 transition-colors hover:text-white">{$t('footer.tos')}</a>
    • © 2025 TechBS LLC.
  </div>
</footer>
