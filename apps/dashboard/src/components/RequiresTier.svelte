<script lang="ts">
  import Icon from '@iconify/svelte';
  import starIcon from '@iconify-icons/mdi/star';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import { env } from '$env/dynamic/public';
  import { cn } from '$lib/util';

  import DynamicTranslatable from './DynamicTranslatable.svelte';

  const rewardTier = page.data.data?.rewardTier;
  const noTier = $derived(rewardTier === 0);

  interface Props {
    minTier: number;
    small?: boolean;
  }

  let { minTier = 10, small }: Props = $props();
</script>

{#snippet tier()}
  <b class="text-white">{$t(`supporter_tiers.${minTier}`)}</b>
{/snippet}

<div
  class={cn(
    'relative flex flex-col items-center gap-4 rounded-2xl border border-teal-400/75 bg-gradient-to-br from-teal-500/25 via-emerald-400/25 to-cyan-500/25 md:flex-row md:justify-between',
    {
      'p-4 shadow-[0_0_10px] shadow-teal-400/25 md:shadow-[0_0_20px]': !small,
      'p-2': small
    }
  )}
>
  <div
    class={cn('drop-shadow-black/50 flex max-w-2xl items-center gap-2 text-lg tracking-tight text-neutral-300 drop-shadow-md md:text-xl', {
      'text-lg md:text-xl': !small,
      'md:text-lg': small
    })}
  >
    <Icon
      icon={starIcon}
      class={cn('flex-none text-white', {
        'size-6 sm:size-8': !small,
        'size-6': small
      })}
    />
    <span><DynamicTranslatable template={$t('supporter_status.feature_available_in')} replacements={{ tier }} /></span>
  </div>
  <div class="flex flex-wrap items-center justify-center gap-3">
    <a
      href={noTier ? `https://patreon.com/${env.PUBLIC_PATREON_URL}` : `https://www.patreon.com/settings/memberships/${env.PUBLIC_PATREON_URL}`}
      class={cn('active:scale-98 rounded-lg bg-white/90 font-medium text-black transition-all hover:bg-white', {
        'px-4 py-2': !small,
        'px-4 py-1 text-sm': small
      })}
      target="_blank"
    >
      {$t(noTier ? 'supporter_status.cta' : 'supporter_status.manage')}
    </a>
  </div>
</div>
