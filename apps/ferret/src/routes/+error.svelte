<script lang="ts">
  import Icon from '@iconify/svelte';
  import errorIcon from '@iconify-icons/mdi/close-octagon';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import SiteHeader from '$components/SiteHeader.svelte';
</script>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 sm:gap-8 sm:p-6">
  <SiteHeader />
  <div class="z-[1] mt-20 flex flex-col items-center">
    <Icon icon={errorIcon} class="mb-4 h-16 w-16 sm:h-20 sm:w-20" />
    <h1 class="font-display text-6xl text-white sm:text-7xl">{page.status}</h1>
    <h4 class="text-xl sm:text-2xl">
      {page.error?.code ? $t(`errors.${page.error.code}`, { default: page.error.error ?? page.error.message }) : page.error?.message}
    </h4>
  </div>
</section>
