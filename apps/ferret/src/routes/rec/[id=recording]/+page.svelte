<script lang="ts">
  import Emittery from 'emittery';
  import { onMount } from 'svelte';

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
  <RecordingHeader />
  <JobSections {emitter} />
  <DownloadSection {emitter} features={data.recording.features} noUsers={data.users.length === 0} />
  <SiteFooter />
</section>

<div class="z-50">
  <Toaster position="bottom-right" theme="dark" />
</div>
