<script lang="ts">
  import Icon from '@iconify/svelte';
  import discordIcon from '@iconify-icons/simple-icons/discord';

  import { cn, SUPPORT_SERVER_URL } from '#lib/util.js';
  import { PUBLIC_CRAIG_ENV } from '$app/env/public';

  import LanguageButton from './LanguageButton.svelte';

  const ENV_TAGS: Record<string, { label: string; color: string }> = {
    nightly: { label: 'Nightly', color: 'text-purple-400' },
    development: { label: 'Development', color: 'text-red-400' },
    selfhosted: { label: 'Self-hosted', color: 'text-teal-400' }
  };

  const envTag = ENV_TAGS[PUBLIC_CRAIG_ENV ?? ''];
</script>

<header class="absolute right-0 left-0 z-1 mx-auto flex w-full max-w-4xl items-center justify-between p-2 sm:p-6">
  <div class="font-display relative flex items-center justify-center gap-1 text-xl text-white sm:gap-2 sm:text-3xl">
    <a class="group flex items-center justify-center gap-2 sm:gap-3" href="https://craig.chat" target="_blank">
      <enhanced:img
        class="h-8 w-8 rounded-md sm:h-10 sm:w-10 sm:rounded-lg"
        src="#assets/craig.png?w=32;40&aspect=1"
        alt="Craig"
        sizes="(min-width:640px) 40px, 32px"
      />
      <div class="font-bold underline decoration-transparent transition-colors group-hover:decoration-teal-500">
        Craig
        {#if envTag}
          <span class={cn('pointer-events-none absolute right-0 -bottom-2 rounded text-xs leading-none font-bold', envTag.color)}>
            {envTag.label}
          </span>
        {/if}
      </div>
    </a>
    <span>Dashboard</span>
  </div>
  <div class="flex items-center gap-1">
    <a href={SUPPORT_SERVER_URL} target="_blank" title="Discord" class="rounded-md p-2 transition-colors hover:bg-white/10 hover:text-white">
      <Icon icon={discordIcon} />
    </a>
    <div class="h-5 w-px bg-current"></div>
    <LanguageButton />
  </div>
</header>
