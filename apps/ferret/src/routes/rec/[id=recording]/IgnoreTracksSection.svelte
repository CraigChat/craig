<script lang="ts">
  import Icon from '@iconify/svelte';
  import dropdownIcon from '@iconify-icons/mdi/chevron-down';
  import clsx from 'clsx';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import RecordingUserChip from '$components/RecordingUserChip.svelte';

  const pageUsers = page.data.users!;

  interface Props {
    name?: string;
    ignored: SvelteSet<number>;
    allIgnoredText?: string;
    previouslyIgnored?: SvelteSet<number>;
  }

  let { name, ignored, allIgnoredText, previouslyIgnored }: Props = $props();
  let users = $derived(previouslyIgnored ? pageUsers.filter((u) => !previouslyIgnored.has(u.track)) : pageUsers);
  let allUsersIgnored = $derived(users.length === ignored.size);
  let expanded = $state(false);
</script>

<div class="flex w-full flex-col items-start gap-1">
  <button
    class="group -ml-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md p-1 transition-all hover:bg-white/10"
    onclick={() => {
      if (allUsersIgnored && expanded) return;
      expanded = !expanded;
    }}
  >
    <div class="flex w-full items-center gap-2 transition-colors group-hover:text-white">
      <span class="font-medium">{name || $t('download.exclude_user.name')}</span>
      {#if ignored.size}
        <span class="rounded-full bg-white/10 bg-zinc-700 px-2 text-xs text-white/75 transition-colors group-hover:bg-white/25">
          {$t('download.exclude_user.count', { values: { count: ignored.size } })}
        </span>
      {/if}
    </div>
    <Icon icon={dropdownIcon} class={clsx('mr-1 scale-150 transition-transform', { 'rotate-180': expanded })} />
  </button>
  <div class="flex flex-wrap gap-2">
    {#if expanded}
      {#each users as user (user.track)}
        <button
          class={clsx('flex gap-1 rounded-full px-2 transition-all', {
            'bg-red-500/10 text-red-500 line-through hover:bg-red-500/25 hover:text-red-200': ignored.has(user.track),
            'bg-zinc-800 hover:bg-zinc-700 hover:text-white': !ignored.has(user.track)
          })}
          onclick={() => (ignored.has(user.track) ? ignored.delete(user.track) : ignored.add(user.track))}
        >
          <RecordingUserChip {user} />
        </button>
      {/each}
    {/if}
  </div>
  {#if allUsersIgnored}
    <span class="text-xs text-red-500">{allIgnoredText || $t('download.exclude_user.all_excluded_warning')}</span>
  {/if}
</div>
