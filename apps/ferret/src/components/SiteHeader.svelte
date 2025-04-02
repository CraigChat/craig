<script>
  import Icon from '@iconify/svelte';
  import discordIcon from '@iconify-icons/simple-icons/discord';

  import { SUPPORT_SERVER_URL } from '$lib/util';

  import LanguageButton from './LanguageButton.svelte';
</script>

<header class="z-[1] inline-flex items-center justify-between">
  <a class="group flex items-center justify-center gap-2 sm:gap-3" href="https://craig.chat" target="_blank">
    <enhanced:img
      class="h-8 w-8 rounded-md sm:h-10 sm:w-10 sm:rounded-lg"
      src="$assets/craig.png?w=32;40&aspect=1"
      alt="Craig"
      sizes="(min-width:640px) 40px, 32px"
    />
    <div
      class="font-display text-xl font-bold text-white underline decoration-transparent transition-colors group-hover:decoration-teal-500 sm:text-3xl"
    >
      Craig
    </div>
  </a>
  <div class="flex items-center gap-1">
    <a href={SUPPORT_SERVER_URL} target="_blank" title="Discord" class="rounded-md p-2 transition-colors hover:bg-white/10 hover:text-white">
      <Icon icon={discordIcon} />
    </a>
    <div class="h-5 w-px bg-current"></div>
    <LanguageButton />
  </div>
</header>
