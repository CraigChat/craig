<script lang="ts">
  import type { Recording } from '@craig/types';
  import Icon from '@iconify/svelte';
  import * as fflate from 'fflate';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import FallbackImage from '$components/FallbackImage.svelte';
  import { PUBLIC_AVATAR_CDN } from '$env/static/public';
  import { loadingIcon } from '$lib/icons';
  import { toast } from '$lib/toaster';
  import { AVATAR_PLACEHOLDER, formatUser, getAvatar, getDefaultAvatar } from '$lib/util';

  const users = page.data.users!;
  const recording = page.data.recording!;
  const displayUsers = users.filter((u) => !!u.avatar || !!u.avatarUrl).slice(0, 3);
  let loading = $state(false);

  function b64ToUInt8(base64: string) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  }

  async function onClick() {
    if (loading) return;
    loading = true;

    const zipContents: Record<string, Uint8Array> = {};

    async function fetchAvatar(user: Recording.RecordingUser) {
      const fileName = `${formatUser(user)}.png`;

      if (user.avatar?.startsWith('data:')) return (zipContents[fileName] = b64ToUInt8(user.avatar.split(',')[1]));

      const start = Date.now();
      const tryUrls = [user.avatarUrl, PUBLIC_AVATAR_CDN ? `${PUBLIC_AVATAR_CDN}/discord-avatars/${user.id}.png` : undefined, getDefaultAvatar(user)];
      for (const url of tryUrls) {
        if (!url) continue;
        try {
          const response = await fetch(url);
          if (response.status !== 200) continue;
          zipContents[fileName] = new Uint8Array(await response.arrayBuffer());
        } catch {}
        break;
      }
      console.log(`${fileName} [${zipContents[fileName] ? 'HIT' : 'MISS'}]: ${Date.now() - start}ms`);
    }

    try {
      await Promise.all(users.filter((u) => !!u.avatar || !!u.avatarUrl || u.discriminator !== 'web').map(fetchAvatar));
      const zip = await new Promise<Uint8Array>((resolve, reject) =>
        fflate.zip(zipContents, { consume: true, level: 0 }, (e, r) => {
          if (e) reject(e);
          else resolve(r);
        })
      );
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `craig-${recording.id}-avatars.png.zip`;
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
      toast.success($t('download.avatar_zip.success'));
    } catch (e) {
      console.error('Failed to download avatars', e);
      toast.error($t('download.avatar_zip.fail'));
    }

    loading = false;
  }
</script>

<button
  class="group relative flex min-h-[6rem] items-center justify-between overflow-hidden rounded-md bg-zinc-700 px-6 py-4 text-left shadow transition-all hover:bg-zinc-600 active:opacity-75"
  onclick={onClick}
>
  <div class="z-10 flex flex-col justify-center gap-1">
    <span class="font-display text-bg text-xl font-bold text-white">{$t('download.avatar_zip.button_name')}</span>
    <span class="text-bg text-sm text-neutral-300">
      {$t(loading ? 'common.downloading' : 'download.avatar_zip.button_description')}
    </span>
  </div>

  <div class={`loading pointer-events-none absolute ${loading ? 'right-4 opacity-100' : '-right-4 opacity-0'} transition-all`}>
    <Icon icon={loadingIcon} class="h-16 w-16 animate-spin" />
  </div>

  <div
    class={`pointer-events-none absolute -bottom-4 -right-4 top-0 flex items-end opacity-50 transition-all group-hover:-bottom-2 group-hover:-right-2 ${
      !loading ? 'md:opacity-100' : ''
    }`}
  >
    <FallbackImage
      {...displayUsers[2] ? { src: getAvatar(displayUsers[2]), fallbackSrc: AVATAR_PLACEHOLDER } : { src: AVATAR_PLACEHOLDER }}
      alt={$t('common.avatar')}
      class="-mb-12 -mr-12 h-20 w-20 rounded bg-zinc-800/50 shadow backdrop-blur transition-all group-hover:-mr-8"
    />
    <FallbackImage
      {...displayUsers[1] ? { src: getAvatar(displayUsers[1]), fallbackSrc: AVATAR_PLACEHOLDER } : { src: AVATAR_PLACEHOLDER }}
      alt={$t('common.avatar')}
      class="-mb-4 -mr-8 h-20 w-20 rounded bg-zinc-800/50 shadow backdrop-blur transition-all group-hover:-mr-4"
    />
    <FallbackImage
      {...displayUsers[0] ? { src: getAvatar(displayUsers[0]), fallbackSrc: AVATAR_PLACEHOLDER } : { src: AVATAR_PLACEHOLDER }}
      alt={$t('common.avatar')}
      class="h-20 w-20 rounded bg-zinc-800/50 shadow backdrop-blur"
    />
  </div>

  <div
    class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-zinc-700/90 to-transparent transition-all group-hover:h-8 group-hover:from-zinc-600/90"
  ></div>
</button>

<style lang="scss">
  .loading {
    filter: drop-shadow(2px 2px 2px #000);
    @apply z-10 text-white;
  }
  .text-bg {
    @apply rounded-lg bg-zinc-700/50 ring-4 ring-zinc-700/50 backdrop-blur-md transition-all;

    button:hover & {
      @apply bg-zinc-600/50 ring-zinc-600/50;
    }
  }
</style>
