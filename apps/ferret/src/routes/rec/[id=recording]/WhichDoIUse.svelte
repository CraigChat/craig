<script lang="ts">
  import { t } from 'svelte-i18n';

  import Button from '$components/Button.svelte';
  import DynamicTranslatable from '$components/DynamicTranslatable.svelte';
  import Modal from '$components/Modal.svelte';

  interface Props {
    onclose?: () => void;
  }

  let { onclose }: Props = $props();
</script>

<Modal title={$t('download.wdiu.name')}>
  <div class="whitespace-break-spaces text-sm sm:text-base">
    <DynamicTranslatable
      template={$t('download.wdiu.content')}
      replacements={{
        audacity: { html: `<a href="https://www.audacityteam.org/" class="text-white underline decoration-teal-500">Audacity</a>` },
        aac: { html: `<b>AAC</b>` },
        flac: { html: `<b>FLAC</b>` }
      }}
    />
  </div>

  {#snippet buttons()}
    <Button onclick={onclose}>
      {$t('common.okay')}
    </Button>
  {/snippet}
</Modal>
