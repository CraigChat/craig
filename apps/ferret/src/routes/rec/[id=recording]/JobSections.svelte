<script lang="ts">
  import Icon from '@iconify/svelte';
  import warnIcon from '@iconify-icons/mdi/alert-outline';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  import { page } from '$app/state';
  import Button from '$components/Button.svelte';
  import RecordingUserChip from '$components/RecordingUserChip.svelte';
  import { jobOpen } from '$lib/recording/data';
  import { SSEClient } from '$lib/sse';
  import { toast } from '$lib/toaster';
  import { tooltip } from '$lib/tooltip';
  import type { MinimalJobInfo, MinimalJobUpdate, RecordingPageEmitter } from '$lib/types';
  import { capitalize, currentTime, formatBytes, formatMilliseconds, getNameFromJob, getRTF, relativeTime } from '$lib/util';

  import NotificationBell from './NotificationBell.svelte';

  // TODO make some noise when this is done?
  // TODO use service worker for mobile notifs

  const recording = page.data.recording!;
  const users = page.data.users!;
  const key = page.data.key!;
  interface Props {
    emitter: RecordingPageEmitter;
  }

  let { emitter }: Props = $props();

  /** The server-side event client to recieve events from. */
  const sseClient = new SSEClient();
  /** The current job data. */
  let job = $state<MinimalJobInfo | null>(null);
  /** The last job update recieved. */
  let lastJobUpdate = $state<MinimalJobUpdate | null>(null);

  /** Whether we are cancelling this job. */
  let cancelling = $state(false);
  /** Whether we are currently streaming this job to the user. */
  let streaming = false;
  /** Whether this job has been streamed to the user. */
  let streamed = $state(false);
  /** If we are currently fetching the job. */
  let fetching = false;
  /** The last time we have fetched the job. */
  let lastFetch = 0;
  /** Whether the job has been started on this page. */
  let startedHere = $state(false);

  /** The element to scroll into view with. */
  let scrollElem: HTMLDivElement | undefined = $state();
  /** The element to trigger downloads with. */
  let downloadElem: HTMLAnchorElement | undefined = $state();
  /** The favicon link element. */
  let iconElem: HTMLLinkElement | undefined = $state();

  /** Whether the job track section has been expanded. */
  let expanded = $state(false);
  /** Intl.RelativeTimeFormat used for formatting. */
  let intlRtf = $derived(getRTF($locale ?? undefined, { numeric: 'auto' }));

  /** The current state of the job. */
  let jobState = $derived(lastJobUpdate?.state || job?.state);
  /** The current status of the job. */
  let status = $derived(lastJobUpdate?.status || job?.status);
  /** The user tracks of the job. */
  let userTracks = $derived(
    users.map((user, i) => ({
      i,
      track: user.track,
      state: jobState?.tracks?.[user.track],
      ignored: job?.options.ignoredTracks?.includes(user.track)
    }))
  );
  /** The formatted name of the job. */
  let jobName = $derived(job ? getNameFromJob(job, $t) : '');
  /** The timestamp of when the job started. */
  let started = $derived(lastJobUpdate?.started || (job ? new Date(job.startedIn).valueOf() : null));
  /** The timestamp of when the job finished. */
  let finished = $derived(lastJobUpdate?.finishedAt || (job?.finishedAt ? new Date(job.finishedAt).valueOf() : null));
  /** The amount of user tracks waiting to be processed. */
  let waitingUsersCount = $derived(userTracks.filter((track) => !track.state && !track.ignored).length);
  /** The amount of user tracks that have finished processing. */
  let finishedUsersCount = $derived(userTracks.filter((track) => track?.state?.progress === 100).length);

  let pollingMode = $state(false);
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  /** Start polling for job updates. */
  function startPolling() {
    pollingMode = true;
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => fetchJob(), 3000);
  }

  /** Stop polling. */
  function stopPolling() {
    pollingMode = false;
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  // Emit status updates
  $effect(() => {
    if (status && status !== 'idle' && status !== 'queued' && status !== 'running') emitter.emit('statusUpdate', status);

    if (iconElem && status && status !== 'idle' && status !== 'queued' && startedHere) {
      iconElem.type = 'image/png';
      iconElem.href = `/assets/favicons/job-${status}.png`;
    } else if (iconElem) {
      iconElem.type = 'image/x-icon';
      iconElem.href = '/favicon.ico';
    }
  });

  // Set jobOpen signal to true if the job is still running
  $effect(() => jobOpen.set(status === 'running'));

  // Auto-scroll job into view when available
  $effect(() => scrollElem?.scrollIntoView({ behavior: 'smooth' }));

  // Trigger a download if the download was started here
  $effect(() => {
    if (status === 'complete' && startedHere) downloadElem?.click();
  });

  /** Starts the SSE connection, and attempts to recieve data to the client. */
  function startStream() {
    if (pollingMode) return;
    sseClient.connect(`/api/v1/recordings/${recording.id}/sse?key=${key}`);
  }

  function onStreamJob(newJob: MinimalJobInfo) {
    lastJobUpdate = null;
    job = newJob;
    lastFetch = Date.now();
    startedHere = true;
    startStream();
  }

  function onDocumentVisibility() {
    // If the user focuses back to the page after a second, refetch
    if (document.visibilityState === 'visible') refetchIfNeeded();
  }

  function refetchIfNeeded() {
    if (lastFetch < Date.now() - 1000 && !streaming && !fetching) fetchJob();
  }

  async function fetchJob() {
    if (fetching) return;
    try {
      fetching = true;
      const response = await fetch(`/api/v1/recordings/${recording.id}/job?key=${key}`).catch(() => null);
      if (!response || !response.ok) return;
      const jobResponse: { job: MinimalJobInfo | null; streamOpen: boolean } = await response.json().catch(() => null);
      job = jobResponse.job;
      if (!job) lastJobUpdate = null;
      lastFetch = Date.now();
      if (jobResponse.streamOpen && !pollingMode) startStream();
    } catch {
    } finally {
      fetching = false;
    }
  }

  async function cancelJob() {
    if (cancelling) return;
    cancelling = true;
    try {
      const response = await fetch(`/api/v1/recordings/${recording.id}/job?key=${key}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 200) {
        if (response.status === 400 || response.status === 404) {
          job = null;
          lastJobUpdate = null;
          startedHere = false;
        } else throw new Error('Response failed');
      }
      const isCancel = status === 'queued' || status === 'running';
      if (!streaming) {
        job = null;
        lastJobUpdate = null;
        startedHere = false;
      } else if (status === 'queued') {
        job = null;
        lastJobUpdate = null;
        startedHere = false;
        streaming = false;
        sseClient.close();
      }
      toast.success($t(isCancel ? 'job.cancelled_job' : 'job.removed_job'));
    } catch (e) {
      console.log('Failed to cancel job', e);
    }
    cancelling = false;
  }

  onMount(() => {
    iconElem = document.querySelector('link[rel="icon"]') as HTMLLinkElement;

    sseClient.on('opened', () => console.log('sse opened'));
    sseClient.on('retry', ({ attempts }) => console.log('sse retry', { attempts }));
    sseClient.on('closed', () => console.log('sse closed'));

    sseClient.on('init', (info) => {
      console.log('sse init', info);
      if (info.streaming === false) {
        job = info.job;
        streaming = false;
        sseClient.close();
      } else {
        streaming = true;
        streamed = true;
      }
    });
    sseClient.on('ping', () => console.log('sse recieved ping'));
    sseClient.on('update', (update) => {
      if (update.job && !update.update) {
        lastJobUpdate = null;
        job = update.job;
      } else if (update.update) lastJobUpdate = update.update;
    });
    sseClient.on('end', (info) => {
      console.log('sse ended', info, status);
      if (info?.error === 'TOO_MANY_CONNECTIONS') {
        toast.error($t('job.too_many_connections'));
        streaming = false;
        sseClient.close();
        startPolling();
        return;
      }
      if (info?.error === 'JOB_NOT_FOUND' && status === 'running') {
        job = null;
        lastJobUpdate = null;
        startedHere = false;
      }
      streaming = false;
      sseClient.close();
    });

    emitter.on('streamJob', onStreamJob);
    fetchJob();
    return () => {
      sseClient.close();
      stopPolling();
      emitter.off('streamJob', onStreamJob);
      jobOpen.set(false);
    };
  });
</script>

<svelte:document onvisibilitychange={onDocumentVisibility} />
<svelte:window onfocus={refetchIfNeeded} />

{#if job}
  <a
    href={`/dl/${job.outputFileName}`}
    class="hidden"
    aria-hidden="true"
    download={`craig-${recording.id}-${job.outputFileName}`}
    bind:this={downloadElem}
  ></a>
{/if}

{#if !streamed && status === 'complete'}
  <div class="shadow-section z-[1] inline-flex flex-col items-start justify-start gap-3 rounded-2xl border border-neutral-600 bg-zinc-900 p-6">
    <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">{$t('job.previous_download')}</h2>
    <div class="flex flex-col items-start justify-start">
      <div class="text-sm font-semibold text-neutral-400 sm:text-base">{jobName}</div>
      {#if started}
        <div class="text-xs font-normal text-neutral-500 sm:text-sm">
          {$t('job.status_time.processed', {
            values: { time: relativeTime(intlRtf, Math.min(0, Math.round(started / 1000 - $currentTime))) }
          })}
          {#if finished}
            • {$t('job.duration', { values: { duration: formatMilliseconds(finished - started, 3) } })}
          {/if}
        </div>
      {/if}
    </div>
    <div class="inline-flex items-start justify-start gap-3 self-stretch">
      <Button
        disabled={cancelling}
        badge={(lastJobUpdate || job)?.outputSize ? formatBytes((lastJobUpdate || job)?.outputSize || 0) : undefined}
        onclick={() => downloadElem?.click()}
      >
        {$t('common.download')}
      </Button>
      <Button danger onclick={cancelJob} disabled={cancelling}>
        {$t('common.remove')}
      </Button>
    </div>
  </div>
{:else if (streamed || startedHere) && jobState}
  <div
    class="relative z-[1] inline-flex flex-col items-start justify-start overflow-hidden rounded-2xl border bg-zinc-900 shadow"
    class:border-blue-600={status === 'running'}
    class:border-neutral-600={status === 'cancelled'}
    class:border-green-600={status === 'complete'}
    class:border-red-600={status === 'error'}
    class:border-zinc-400={status === 'queued'}
    class:shadow-green-600={status === 'complete'}
    class:shadow-blue-600={status === 'running'}
    class:shadow-zinc-600={status === 'queued'}
  >
    <!-- Element to scroll to when starting a job -->
    <div class="absolute -top-7" bind:this={scrollElem}></div>

    <div
      class="flex flex-col items-start justify-start gap-3 self-stretch p-6"
      class:bg-blue-600={status === 'running'}
      class:bg-neutral-600={status === 'cancelled'}
      class:bg-green-600={status === 'complete'}
      class:bg-red-600={status === 'error'}
      class:bg-opacity-10={status !== 'running'}
      class:bg-opacity-25={status === 'running'}
    >
      <div class="flex items-center justify-between self-stretch">
        <h2 class="font-display text-xl font-bold text-neutral-100 sm:text-2xl">
          {#if status === 'running'}
            {$t(`job.state_type.${jobState.type || 'processing'}`, { default: `${capitalize(jobState.type || 'processing')}…` })}
          {:else if status}
            {$t(`job.status.${status}`)}
          {/if}
        </h2>
        <div class="flex gap-2">
          {#if pollingMode}
            <div
              use:tooltip={{
                content: $t('job.polling_warning'),
                placement: 'left',
                offset: 15
              }}
            >
              <Icon icon={warnIcon} class="h-6 w-6" />
            </div>
          {/if}
          <NotificationBell visible={status === 'running'} {emitter} />
        </div>
      </div>
      <div class="flex flex-col items-start justify-start">
        <span class="text-sm font-semibold text-neutral-100 sm:text-base">{jobName}</span>
        {#if started}
          <div class="text-xs font-normal text-neutral-400 sm:text-sm">
            {$t(`job.status_time.${status === 'running' ? 'started' : status === 'queued' ? 'queued' : 'processed'}`, {
              values: { time: relativeTime(intlRtf, Math.min(0, Math.round(started / 1000 - $currentTime))) }
            })}
            {#if finished}
              • {$t('job.duration', { values: { duration: formatMilliseconds(finished - started, 3) } })}
            {/if}
          </div>
        {/if}
      </div>
      {#if startedHere && status === 'complete'}
        <p class="mb-2 text-sm text-neutral-300 sm:text-base">
          {$t('job.download_complete')}
        </p>
      {/if}
      {#if status === 'queued'}
        <p class="mb-2 text-sm text-neutral-300 sm:text-base">
          {$t('job.queued_description')}
          {#if jobState?.position}
            <i>{$t('job.queue_position', { values: { position: jobState.position } })}</i>
          {/if}
        </p>
      {/if}
      {#if status !== 'cancelled'}
        <div class="inline-flex items-start justify-start gap-3 self-stretch">
          {#if status === 'running' || status === 'queued'}
            <Button onclick={cancelJob} disabled={cancelling}>
              {$t('common.cancel')}
            </Button>
          {:else if status === 'complete'}
            <Button
              disabled={cancelling}
              badge={(lastJobUpdate || job)?.outputSize ? formatBytes((lastJobUpdate || job)?.outputSize || 0) : undefined}
              onclick={() => downloadElem?.click()}
            >
              {$t('common.download')}
            </Button>
            <Button danger onclick={cancelJob} disabled={cancelling}>
              {$t('common.remove')}
            </Button>
          {:else}
            <Button danger onclick={cancelJob} disabled={cancelling}>
              {$t('common.remove')}
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    {#if status === 'running' && jobState?.tracks}
      <div
        class="flex flex-col items-start justify-start gap-2 self-stretch bg-black/20 px-6 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:text-base"
      >
        <span>
          {$t('job.tracks_status', { values: { finishedCount: finishedUsersCount, waitingCount: waitingUsersCount } })}
        </span>
        <button class="font-semibold text-neutral-300 hover:underline" onclick={() => (expanded = !expanded)}>
          {#if expanded}
            {$t('common.show_less')}
          {:else}
            {$t('common.show_all')}
          {/if}
        </button>
      </div>
      <div class="flex flex-col items-center justify-center gap-6 self-stretch p-6">
        {#if !expanded && !userTracks.some((t) => t.state && t.state.progress !== 100)}
          <span>{$t('job.loading_track')}</span>
        {/if}
        {#each userTracks as track (track.track)}
          {#if !track.ignored && (expanded || (track.state && track.state.progress !== 100))}
            <div class="flex flex-col items-center justify-center gap-2 self-stretch">
              <div class="inline-flex items-center justify-start gap-2 self-stretch text-neutral-400">
                <span class="h-5 select-none rounded-xl bg-black/20 px-1.5 py-0.5 text-xs text-neutral-300">{track.track}</span>
                <RecordingUserChip user={users[track.i]} />
              </div>
              <div
                class="relative inline-flex h-2 items-center justify-start self-stretch overflow-hidden rounded-lg bg-black"
                class:animate-pulse={!track.state}
                class:bg-opacity-75={!track.state}
                class:bg-opacity-25={track.state}
              >
                {#if track.state}
                  <div
                    class="h-full rounded-lg transition-all duration-100"
                    class:bg-teal-500={track.state.progress !== 100}
                    class:bg-green-500={track.state.progress === 100}
                    style:width={`${track.state.progress}%`}
                  ></div>
                {/if}
                {#if track.state?.processing}
                  <div class="striped absolute bottom-0 left-0 right-0 top-0"></div>
                {/if}
              </div>
              <div class="inline-flex select-none items-center justify-between gap-3 self-stretch text-sm sm:text-base">
                <span class="text-neutral-100">
                  {#if !track.state}
                    {$t('job.track_state.waiting')}
                  {:else if track.state.processing}
                    {$t('job.track_state.processing')}
                  {:else if track.state.progress === 100}
                    {$t('job.track_state.done')}
                  {:else}
                    {track.state.progress.toFixed(0)}%
                  {/if}
                </span>
                {#if track.state?.time}
                  <span class="font-mono text-xs font-normal text-neutral-400 sm:text-sm">{track.state?.time}</span>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {:else if status === 'running' && jobState?.progress && jobState?.time}
      <div class="flex flex-col items-center justify-center gap-2 self-stretch p-6">
        <div class="relative inline-flex h-2 items-center justify-start self-stretch overflow-hidden rounded-lg bg-black">
          <div
            class="h-full rounded-lg transition-all duration-100"
            class:bg-teal-500={jobState.progress !== 100}
            class:bg-green-500={jobState.progress === 100}
            style:width={`${jobState.progress}%`}
          ></div>
        </div>
        <div class="inline-flex select-none items-center justify-between gap-3 self-stretch text-sm sm:text-base">
          <span class="text-neutral-100">
            {#if jobState.progress === 100}
              {$t('job.track_state.done')}
            {:else}
              {jobState.progress.toFixed(0)}%
            {/if}
          </span>
          {#if jobState?.time}
            <span class="font-mono text-xs font-normal text-neutral-400 sm:text-sm">{jobState?.time}</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  @keyframes move {
    0% {
      background-position: 0 0;
    }
    100% {
      background-position: 50px 50px;
    }
  }

  .striped {
    background-image: linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.2) 25%,
      transparent 25%,
      transparent 50%,
      rgba(255, 255, 255, 0.2) 50%,
      rgba(255, 255, 255, 0.2) 75%,
      transparent 75%,
      transparent
    );
    background-size: 50px 50px;
    animation: move 2s linear infinite;
  }
</style>
