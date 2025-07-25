<script lang="ts">
  import Icon from '@iconify/svelte';
  import outLinkIcon from '@iconify-icons/mdi/launch';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { persisted } from 'svelte-persisted-store';

  const SURVEY_ID = '07-2025';
  const URL = 'https://forms.gle/cjie55nZH7kHo4n39';
  const SURVEY_END_DATE = '2025-08-08T04:00:00.000Z';
  const surveyAcked = persisted<string | null>('craig-survey', null);
  let show = $state(false);
  onMount(() => {
    if ($surveyAcked !== SURVEY_ID && new Date(SURVEY_END_DATE).valueOf() > Date.now()) show = true;
  });

  function surveyAck() {
    show = false;
    $surveyAcked = SURVEY_ID;
    window.plausible('surveyack');
  }
</script>

{#if show}
  <div
    class="shadow-section z-[1] inline-flex flex-col items-center gap-2 rounded-2xl bg-gradient-to-t from-zinc-900 to-teal-950 px-4 py-2 ring-2 ring-teal-600 sm:flex-row sm:justify-between"
  >
    <div class="text-center text-sm text-neutral-200 sm:text-left sm:text-base">
      {$t('survey.text')}
    </div>
    <div class="flex justify-end gap-1 text-xs font-medium text-white sm:text-sm">
      <a
        href={URL}
        target="_blank"
        class="flex items-center gap-1 rounded-md bg-teal-600 px-2 py-1 transition-all hover:bg-teal-700 active:opacity-75"
        onclick={surveyAck}
      >
        <span>{$t('survey.cta')}</span>
        <Icon icon={outLinkIcon} class="flex-none" />
      </a>
      <button class="rounded-md px-2 py-1 transition-all hover:bg-zinc-700/50 active:opacity-75" onclick={surveyAck}>
        {$t('common.dismiss')}
      </button>
    </div>
  </div>
{/if}
