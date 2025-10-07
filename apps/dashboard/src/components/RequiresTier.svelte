<script lang="ts">
  import Icon from '@iconify/svelte';
  import starIcon from '@iconify-icons/mdi/star';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import { env } from '$env/dynamic/public';

  import DynamicTranslatable from './DynamicTranslatable.svelte';

  const rewardTier = page.data.data?.rewardTier;
  const noTier = $derived(rewardTier === 0);

  interface Props {
    minTier: number;
  }

  let { minTier = 10 }: Props = $props();
</script>

{#snippet tier()}
  <b class="text-white">{$t(`supporter_tiers.${minTier}`)}</b>
{/snippet}

<div
  class="relative flex flex-col items-center gap-4 rounded-2xl border border-teal-400/75 bg-gradient-to-br from-teal-500/25 via-emerald-400/25 to-cyan-500/25 p-4 shadow-[0_0_10px] shadow-teal-400/25 md:flex-row md:justify-between md:shadow-[0_0_20px]"
>
  <div class="drop-shadow-black/50 flex max-w-2xl items-center gap-2 text-lg tracking-tight text-neutral-300 drop-shadow-md md:text-xl">
    <Icon icon={starIcon} class="size-6 flex-none text-white sm:size-8" />
    <span><DynamicTranslatable template={$t('supporter_status.feature_available_in')} replacements={{ tier }} /></span>
  </div>
  <div class="flex flex-wrap items-center justify-center gap-3">
    <a
      href={noTier ? `https://patreon.com/${env.PUBLIC_PATREON_URL}` : `https://www.patreon.com/settings/memberships/${env.PUBLIC_PATREON_URL}`}
      class="active:scale-98 rounded-lg bg-white/90 px-4 py-2 font-medium text-black transition-all hover:bg-white"
      target="_blank"
    >
      {$t(noTier ? 'supporter_status.cta' : 'supporter_status.manage')}
    </a>
  </div>
</div>
