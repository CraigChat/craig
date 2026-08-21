<script lang="ts">
  import Icon from '@iconify/svelte';
  import alertIcon from '@iconify-icons/mdi/alert-circle';
  import Emittery from 'emittery';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  import MaintenanceBanner from '$components/MaintenanceBanner.svelte';
  import SiteFooter from '$components/SiteFooter.svelte';
  import SiteHeader from '$components/SiteHeader.svelte';
  import SurveyBanner from '$components/SurveyBanner.svelte';
  import { Toaster } from '$lib/toaster';
  import type { RecordingPageEvents } from '$lib/types';

  import type { PageData } from './$types';
  import DownloadSection from './DownloadSection.svelte';
  import JobSections from './JobSections.svelte';
  import RecordingHeader from './RecordingHeader.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const emitter = new Emittery<RecordingPageEvents>();

  // TODO respect reduced motion

  onMount(() => {
    window.plausible('pageview', { u: `${location.origin}/rec/:id` });
  });
</script>

<svelte:head>
  <title>{data.recording.guild.name} — Craig</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 sm:gap-8 sm:p-6">
  <SiteHeader />
  <SurveyBanner />
  <MaintenanceBanner />
  {#if data.recording.redacted}
    <div class="z-[1] flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
      <Icon icon={alertIcon} class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
      <div class="flex flex-col gap-1">
        <span class="text-sm font-semibold text-amber-300 sm:text-base">{$t('recording.redacted_warning.title')}</span>
        <span class="text-sm text-amber-200/90">{$t('recording.redacted_warning.description')}</span>
      </div>
    </div>
  {/if}
  <RecordingHeader />
  <JobSections {emitter} />
  <DownloadSection {emitter} features={data.recording.features} noUsers={data.users.length === 0} live={data.live} />
  <SiteFooter />
</section>

<div class="z-50">
  <Toaster position="bottom-right" theme="dark" />
</div>
