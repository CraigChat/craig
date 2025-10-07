<script lang="ts">
  import Icon from '@iconify/svelte';
  import discordIcon from '@iconify-icons/simple-icons/discord';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';

  type Props = { next?: string };
  let { next }: Props = $props();
</script>

<section class="flex h-[calc(100svh-3rem)] flex-col items-center justify-center gap-4 p-2 text-center sm:h-[calc(100svh-5.5rem)] sm:gap-8">
  <div class="flex flex-col gap-1">
    <h2 class="font-medium text-neutral-200 sm:text-lg">{$t('login_page.header')}</h2>
    <p class="text-xs sm:text-sm">{$t('login_page.disclaimer')}</p>
  </div>

  <a
    class="bg-discord/75 hover:bg-discord/90 active:scale-98 active:bg-discord relative flex flex-none cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-2 text-white backdrop-blur-sm transition-all ease-out sm:gap-4 sm:px-8 sm:py-4 sm:text-lg"
    href={`/api/login?next=${encodeURIComponent(next ?? page.url.pathname + page.url.search)}`}
  >
    <Icon icon={discordIcon} class="size-6" />
    <span class="whitespace-nowrap">{$t('login_page.login')}</span>
  </a>

  <div class="text-sm sm:text-base">
    <a href="https://craig.chat/privacy" class="font-medium text-neutral-200 transition-colors hover:text-white">{$t('footer.privacy')}</a>
    •
    <a href="https://craig.chat/terms" class="font-medium text-neutral-200 transition-colors hover:text-white">{$t('footer.tos')}</a>
    • © 2025 TechBS LLC.
  </div>
</section>
