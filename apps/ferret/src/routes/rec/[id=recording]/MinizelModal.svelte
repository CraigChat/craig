<script lang="ts">
  import type { Recording } from '@craig/types';
  import Icon from '@iconify/svelte';
  import checkIcon from '@iconify-icons/mdi/check-circle';
  import cogIcon from '@iconify-icons/mdi/cog';
  import downloadIcon from '@iconify-icons/mdi/download';
  import errorIcon from '@iconify-icons/mdi/error';
  import { canEncodeAudio, registerEncoder } from 'mediabunny';
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  import { page } from '$app/state';
  import Button from '$components/Button.svelte';
  import Checkbox from '$components/Checkbox.svelte';
  import Modal from '$components/Modal.svelte';
  import RecordingUserChip from '$components/RecordingUserChip.svelte';
  import { loadingIcon } from '$lib/icons';
  import {
    convertToTimeMark,
    createResilientStream,
    formatBytes,
    LibAVFlacEncoder,
    type MinizelFormat,
    MinizelProcessor,
    MixedProcessor,
    type TrackStats
  } from '$lib/minizel';

  const recording = page.data.recording!;
  const users: Recording.RecordingUser[] = page.data.users!;
  const key = page.data.key!;

  interface Props {
    format: MinizelFormat;
    mix?: boolean;
    onclose?: () => void;
    onprocessingchange?: (isProcessing: boolean) => void;
  }

  let { format, mix = false, onclose, onprocessingchange }: Props = $props();

  type ProcessState = 'idle' | 'selecting' | 'downloading' | 'processing' | 'complete' | 'error';

  let processState = $state<ProcessState>('idle');
  let errorMessage = $state('');
  let processor: MinizelProcessor | MixedProcessor | null = $state(null);
  let iconElem: HTMLLinkElement | undefined = $state();

  // Stats
  let elapsedMs = $state(0);
  let startTime = $state(0);
  let downloadedBytes = $state(0);
  let totalBytes = $state(0);
  let heldBytes = $state(0);
  let bytesWritten = $state(0);
  let trackStats: TrackStats[] = $state([]);
  let mixPosition = $state(0);

  // UI update throttling
  const UI_UPDATE_INTERVAL_MS = 200;
  const SPEED_SAMPLE_INTERVAL_MS = 1000;
  let lastUIUpdateTime = $state(0);
  let lastSpeedSampleTime = $state(0);
  let currentDownloadSpeed = $state(0);
  let currentWriteSpeed = $state(0);

  // Track if we're in a state where modal shouldn't be closed
  let isProcessing = $derived(processState === 'downloading' || processState === 'processing');

  // Notify parent of processing state changes
  $effect(() => {
    onprocessingchange?.(isProcessing);
  });

  // Elapsed time ticker (updates every 500ms for display)
  // Stops when processing completes or encounters an error
  $effect(() => {
    if (startTime !== 0 && processState !== 'complete' && processState !== 'error') {
      const interval = setInterval(() => (elapsedMs = Math.max(0, performance.now() - startTime)), 500);
      return () => clearInterval(interval);
    } else if (startTime !== 0 && (processState === 'complete' || processState === 'error')) {
      // Update one final time when process ends
      elapsedMs = Math.max(0, performance.now() - startTime);
    }
  });

  // Track exclusion - use SvelteSet for automatic reactivity
  let excludedTracks = new SvelteSet<number>();

  // Track serial -> user mapping - use SvelteMap for automatic reactivity
  let trackUsers = new SvelteMap<number, Recording.RecordingUser>();

  // Map track number -> stats for display
  let trackStatsMap = $derived(new Map(trackStats.map((s) => [s.serial, s])));

  // Download progress percentage
  let downloadProgress = $derived(totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0);

  // Format speed as MB/s
  function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    else if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${bytesPerSec.toFixed(0)} B/s`;
  }

  function toggleTrackExclusion(trackNumber: number) {
    if (excludedTracks.has(trackNumber)) excludedTracks.delete(trackNumber);
    else excludedTracks.add(trackNumber);
  }

  function isAllExcluded(): boolean {
    return users.length > 0 && excludedTracks.size === users.length;
  }

  function updateStats(force = false) {
    const now = performance.now();
    if (!processor) return;

    // Throttle UI updates (unless forced)
    if (!force && now - lastUIUpdateTime < UI_UPDATE_INTERVAL_MS) return;
    lastUIUpdateTime = now;

    const prevDownloaded = downloadedBytes;
    const prevWritten = bytesWritten;
    downloadedBytes = processor.downloadedBytes;

    if (processor instanceof MinizelProcessor) {
      heldBytes = processor.totalQueuedBytes();
      trackStats = processor.getTrackStats();
      bytesWritten = Array.from(processor.bytesWritten.values()).reduce((a, b) => a + b, 0);
    } else {
      heldBytes = processor.estimatedQueuedBytes();
      bytesWritten = processor.bytesWritten;
      mixPosition = processor.currentMixPosition;
    }

    // Calculate speed (less frequently than UI updates)
    if (now - lastSpeedSampleTime >= SPEED_SAMPLE_INTERVAL_MS) {
      const timeDelta = (now - lastSpeedSampleTime) / 1000;
      currentDownloadSpeed = timeDelta > 0 ? (downloadedBytes - prevDownloaded) / timeDelta : 0;
      currentWriteSpeed = timeDelta > 0 ? (bytesWritten - prevWritten) / timeDelta : 0;
      lastSpeedSampleTime = now;
    }

    // Transition to processing state when download complete
    if (processState === 'downloading' && totalBytes > 0 && downloadedBytes >= totalBytes) processState = 'processing';
  }

  function getFileName(serial: number): string {
    const user = trackUsers.get(serial);
    if (user)
      return `${user.track}-${(user.discriminator === '0' ? user.username : `${user.username}#${user.discriminator}`).replace(/[^a-zA-Z0-9]/g, '_')}.${format}`;
    return `${serial}-track.${format}`;
  }

  function onTrackDiscovered(serial: number, _type: 'opus' | 'flac') {
    const user = users.find((u) => u.track === serial);
    if (user) trackUsers.set(serial, user);
  }

  let flacPolyfillRegistered = false;
  async function ensureFlacSupport() {
    if (format !== 'flac' || flacPolyfillRegistered) return;

    const canEncode = await canEncodeAudio('flac', {
      numberOfChannels: 2,
      sampleRate: 48000
    });

    if (!canEncode) {
      console.log('Native FLAC encoding not supported, registering LibAV polyfill');
      registerEncoder(LibAVFlacEncoder);
      flacPolyfillRegistered = true;
    }
  }

  async function startProcessing() {
    await ensureFlacSupport();
    processState = 'selecting';
    errorMessage = '';

    // Reset stats
    lastUIUpdateTime = 0;
    lastSpeedSampleTime = 0;
    currentDownloadSpeed = 0;
    currentWriteSpeed = 0;
    downloadedBytes = 0;
    bytesWritten = 0;
    totalBytes = 0;

    try {
      // Show file/directory picker
      let directoryHandle: FileSystemDirectoryHandle | null = null;
      let fileHandle: FileSystemFileHandle | null = null;

      if (mix) {
        // Single file for mix
        const ext = format === 'aac' ? 'aac' : format === 'flac' ? 'flac' : 'wav';
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `craig-${recording.id}-mix.${ext}`,
          types: [
            {
              description: `${format.toUpperCase()} Audio`,
              // @ts-ignore
              accept: { [`audio/${ext}`]: [`.${ext}`] }
            }
          ]
        });
      } else {
        // Directory for multi-track
        directoryHandle = await window.showDirectoryPicker({
          mode: 'readwrite',
          id: `minizel-${recording.id}`
        });

        // Check if directory is empty, if not create a subdirectory
        const isEmpty = (await directoryHandle.keys().next()).done;
        if (!isEmpty) {
          directoryHandle = await directoryHandle.getDirectoryHandle(`craig-${recording.id}`, { create: true });
        }
      }

      processState = 'downloading';
      startTime = performance.now();

      // Create resilient stream that auto-retries on connection drops
      const abortController = new AbortController();
      const rawStream = createResilientStream(`/api/v1/recordings/${recording.id}/raw.dat?key=${key}`, {
        maxRetries: 15,
        retryDelay: 1000,
        signal: abortController.signal,
        onRetry: (attempt, bytes) => {
          console.log(`Retrying connection #${attempt} at ${formatBytes(bytes)}`);
        },
        onTotalSize: (size) => (totalBytes = size)
      });

      if (mix && fileHandle) {
        const mixProcessor = new MixedProcessor({
          reader: rawStream.getReader(),
          fileHandle,
          format: format as 'aac' | 'flac' | 'wav',
          excludedTracks: excludedTracks.size > 0 ? excludedTracks : undefined,
          onProgress: updateStats
        });
        processor = mixProcessor;
        await mixProcessor.start();
      } else if (directoryHandle) {
        const multiProcessor = new MinizelProcessor({
          reader: rawStream.getReader(),
          directoryHandle,
          format,
          excludedTracks: excludedTracks.size > 0 ? excludedTracks : undefined,
          onFileName: getFileName,
          onTrackDiscovered,
          onProgress: updateStats
        });
        processor = multiProcessor;
        await multiProcessor.start();
      }

      updateStats(true); // Force final stats update
      processState = 'complete';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        processState = 'idle';
        return;
      }
      console.error('Minizel error:', e);
      errorMessage = e instanceof Error ? e.message : String(e);
      processState = 'error';
    } finally {
      processor = null;
    }
  }

  function resetFavicon() {
    const icon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    if (icon) {
      icon.type = 'image/x-icon';
      icon.href = '/favicon.ico';
    }
  }

  async function handleCancel() {
    if ((processState === 'processing' || processState === 'downloading') && processor) {
      processor.abort();
      try {
        await processor.cleanup();
      } catch (e) {
        console.error('Cleanup error:', e);
      }
      processor = null;
    }

    resetFavicon();
    onclose?.();
  }

  // Update favicon based on processing state
  $effect(() => {
    if (iconElem && (processState === 'downloading' || processState === 'processing' || processState === 'complete')) {
      iconElem.type = 'image/png';
      iconElem.href = `/assets/favicons/job-${processState === 'complete' ? 'complete' : 'running'}.png`;
    } else if (iconElem) {
      iconElem.type = 'image/x-icon';
      iconElem.href = '/favicon.ico';
    }
  });

  onMount(() => {
    iconElem = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
  });

  onDestroy(() => {
    if ((processState === 'processing' || processState === 'downloading') && processor) {
      processor.abort();
      processor.cleanup().catch(() => {});
    }
    resetFavicon();
  });
</script>

<Modal>
  {#snippet title()}
    {$t('download.minizel.title')}
    <span class="rounded-full bg-purple-400 px-2 py-1 text-xs font-bold uppercase text-black">{$t('common.beta')}</span>
  {/snippet}
  {#if processState === 'idle'}
    <div class="text-sm sm:text-base">
      {#if mix}
        <p>{$t('download.minizel.mix_description')}</p>
      {:else}
        <p>{$t('download.minizel.multi_description')}</p>
      {/if}
    </div>

    <div class="rounded bg-zinc-800 p-3">
      <div class="font-medium text-neutral-300">
        {$t('common.format')}:
        <span class="text-white">{$t(mix ? 'download.sections.st' : 'download.sections.mt')} {format.toUpperCase()}</span>
      </div>
    </div>

    <!-- Track selection -->
    {#if users.length > 0}
      <div class="max-h-60 overflow-y-auto rounded bg-zinc-800">
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-[2] bg-zinc-700 text-left text-neutral-300">
            <tr>
              <th class="w-10 px-3 py-2"></th>
              <th class="px-3 py-2">{$t('download.minizel.track')}</th>
            </tr>
          </thead>
          <tbody>
            {#each users as user (user.track)}
              {@const isIncluded = !excludedTracks.has(user.track)}
              <tr
                class="cursor-pointer border-t border-zinc-700 transition-colors hover:bg-zinc-700/50"
                class:opacity-50={!isIncluded}
                onclick={() => toggleTrackExclusion(user.track)}
              >
                <td class="px-3 py-2 text-center" onclick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isIncluded} onchange={() => toggleTrackExclusion(user.track)} />
                </td>
                <td class="px-3 py-2">
                  <RecordingUserChip {user} />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if processState === 'selecting'}
    <div class="flex items-center justify-center gap-3 py-8">
      <Icon icon={loadingIcon} class="h-8 w-8 animate-spin text-teal-400" />
      <span class="text-lg">{$t('download.minizel.selecting')}</span>
    </div>
  {:else if processState === 'downloading' || processState === 'processing'}
    <div class="flex flex-col gap-3">
      <div class="rounded bg-zinc-800 p-3">
        <div class="text-xs font-medium text-neutral-300">
          {$t('common.format')}:
          <span class="text-white">{$t(mix ? 'download.sections.st' : 'download.sections.mt')} {format.toUpperCase()}</span>
        </div>
      </div>

      <div class="rounded bg-zinc-800 p-3">
        <div class="flex items-center gap-3">
          {#if processState === 'downloading'}
            <Icon icon={downloadIcon} class="h-6 w-6 text-blue-400" />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">{$t('common.downloading')}</div>
              <div class="text-xs text-neutral-400">
                {formatBytes(downloadedBytes)}{#if totalBytes > 0}{' / '}{formatBytes(totalBytes)}{/if}
                {#if currentDownloadSpeed > 0}
                  • {formatSpeed(currentDownloadSpeed)}{/if}
              </div>
            </div>
          {:else}
            <Icon icon={cogIcon} class="h-6 w-6 animate-spin text-purple-400" />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">{$t('common.processing')}</div>
              <div class="text-xs text-neutral-400">{$t('download.minizel.processing_desc')}</div>
            </div>
          {/if}
          <div class="text-right font-mono text-sm text-neutral-300">
            {convertToTimeMark(elapsedMs / 1000)}
          </div>
        </div>

        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-700">
          {#if totalBytes > 0}
            <div
              class="h-full rounded-full transition-all duration-300"
              class:bg-blue-500={processState === 'downloading'}
              class:bg-purple-500={processState === 'processing'}
              style="width: {downloadProgress}%"
            ></div>
          {/if}
        </div>
        <div class="flex items-center justify-between gap-4 text-xs text-neutral-400">
          <span>
            {#if processState === 'downloading'}
              {$t('download.minizel.download_pause_warning')}
            {/if}
          </span>
          <div class="flex flex-wrap items-center gap-2">
            <span>{$t('download.minizel.buffered')}: <span class="font-mono text-neutral-300">{formatBytes(heldBytes)}</span></span>
            <span>{$t('download.minizel.write_speed')}: <span class="font-mono text-neutral-300">{formatSpeed(currentWriteSpeed)}</span></span>
            <!-- <span>Total Written: <span class="font-mono text-neutral-300">{formatBytes(bytesWritten)}</span></span> -->
          </div>
        </div>
      </div>

      {#if mix}
        <!-- Mix progress -->
        <div class="rounded bg-zinc-800 p-3">
          <div class="flex items-center justify-between text-sm">
            <span class="text-neutral-300">{$t('download.minizel.position')}</span>
            <span class="font-mono text-white">{convertToTimeMark(mixPosition / 48000)}</span>
          </div>
        </div>
      {:else}
        <!-- Per-track progress - show all users -->
        <div class="max-h-60 overflow-y-auto rounded bg-zinc-800">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-[2] bg-zinc-700 text-left text-neutral-300">
              <tr>
                <th class="px-3 py-2">{$t('download.minizel.track')}</th>
                <th class="px-3 py-2 text-right">{$t('download.minizel.written')}</th>
                <th class="px-3 py-2 text-right">{$t('download.minizel.position')}</th>
              </tr>
            </thead>
            <tbody>
              {#each users as user (user.track)}
                {@const stats = trackStatsMap.get(user.track)}
                {@const isExcluded = excludedTracks.has(user.track)}
                <tr class="border-t border-zinc-700" class:opacity-50={isExcluded}>
                  <td class="px-3 py-2">
                    <RecordingUserChip {user} />
                  </td>
                  <td class="px-3 py-2 text-right font-mono text-neutral-300">
                    {#if isExcluded}
                      <span class="text-neutral-500">{$t('download.minizel.excluded')}</span>
                    {:else if stats}
                      {formatBytes(stats.bytesWritten)}
                    {:else}
                      <Icon icon={loadingIcon} class="inline h-3 w-3 animate-spin" />
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right font-mono text-neutral-300">
                    {#if isExcluded}
                      —
                    {:else if stats}
                      {convertToTimeMark(stats.position / 48000)}
                    {:else}
                      —
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {:else if processState === 'complete'}
    <div class="flex flex-col items-center gap-4 py-4">
      <Icon icon={checkIcon} class="h-12 w-12 text-green-500" />
      <div class="text-center">
        <p class="text-lg font-medium text-white">{$t('download.minizel.complete_message')}</p>
        <p class="text-sm text-neutral-400">
          {$t('download.minizel.complete_stats', {
            values: {
              time: convertToTimeMark(elapsedMs / 1000),
              size: formatBytes(bytesWritten)
            }
          })}
        </p>
      </div>
    </div>

    <!-- Show final track stats for multi-track -->
    {#if !mix && users.length > 0}
      <div class="max-h-48 overflow-y-auto rounded bg-zinc-800">
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-[2] bg-zinc-700 text-left text-neutral-300">
            <tr>
              <th class="px-3 py-2">{$t('download.minizel.track')}</th>
              <th class="px-3 py-2 text-right">{$t('download.minizel.written')}</th>
              <th class="px-3 py-2 text-right">{$t('download.minizel.position')}</th>
            </tr>
          </thead>
          <tbody>
            {#each users as user (user.track)}
              {@const stats = trackStatsMap.get(user.track)}
              {@const isExcluded = excludedTracks.has(user.track)}
              <tr class="border-t border-zinc-700" class:opacity-50={isExcluded}>
                <td class="px-3 py-2">
                  <RecordingUserChip {user} />
                </td>
                <td class="px-3 py-2 text-right font-mono text-neutral-300">
                  {#if isExcluded}
                    <span class="text-neutral-500">{$t('download.minizel.excluded')}</span>
                  {:else if stats}
                    {formatBytes(stats.bytesWritten)}
                  {:else}
                    —
                  {/if}
                </td>
                <td class="px-3 py-2 text-right font-mono text-neutral-300">
                  {#if isExcluded}
                    —
                  {:else if stats}
                    {convertToTimeMark(stats.position / 48000)}
                  {:else}
                    —
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if processState === 'error'}
    <div class="flex flex-col items-center gap-4 py-6">
      <Icon icon={errorIcon} class="h-16 w-16 text-red-500" />
      <div class="text-center">
        <p class="text-lg font-medium text-white">{$t('download.minizel.error_message')}</p>
        <p class="text-sm text-red-400">{errorMessage}</p>
      </div>
    </div>
  {/if}

  {#snippet buttons()}
    {#if processState === 'idle'}
      <Button onclick={onclose}>
        {$t('common.cancel')}
      </Button>
      <Button primary onclick={startProcessing} disabled={isAllExcluded()}>
        {$t('download.minizel.start')}
      </Button>
    {:else if processState === 'downloading' || processState === 'processing'}
      <Button onclick={handleCancel}>
        {$t('download.minizel.cancel')}
      </Button>
    {:else}
      <Button primary onclick={onclose}>
        {$t('common.close')}
      </Button>
    {/if}
  {/snippet}
</Modal>
