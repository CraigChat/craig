<script lang="ts">
  import type { Recording } from '@craig/types';
  import Icon from '@iconify/svelte';
  import webIcon from '@iconify-icons/mdi/microphone-message';
  import { t } from 'svelte-i18n';

  import { getAvatar, getDefaultAvatar } from '$lib/util';

  import FallbackImage from './FallbackImage.svelte';

  interface Props {
    user: Omit<Recording.RecordingUser, 'track' | 'unknown'>;
  }

  let { user }: Props = $props();
</script>

<div class="inline-flex items-center justify-center gap-2">
  {#if user.discriminator === 'web'}
    <div class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/20">
      <Icon icon={webIcon} class="text-teal-500" />
    </div>
  {:else}
    <FallbackImage class="h-5 w-5 rounded-full bg-black/20" src={getAvatar(user)} alt={user.username} fallbackSrc={getDefaultAvatar(user)} />
  {/if}
  <div class="flex items-center justify-center">
    <div class="font-display text-sm font-medium sm:text-base">
      <span>{user.username}</span>
      {#if user.discriminator !== '0' && user.discriminator !== 'web'}
        <span class="text-xs opacity-50">#{user.discriminator}</span>
      {/if}
    </div>
  </div>
  {#if user.bot}
    <div class="bg-discord rounded px-1 text-xs font-semibold uppercase text-white">{$t('common.app')}</div>
  {/if}
</div>
