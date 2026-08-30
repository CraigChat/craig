<script lang="ts">
  interface Props {
    class: string;
    src: string;
    alt: string;
    fallbackSrc?: string;
  }

  let { class: _class, src = $bindable(), alt, fallbackSrc = '' }: Props = $props();

  let realSrc = $state(src);
</script>

<img class={_class} src={realSrc} {alt} onerror={fallbackSrc ? () => (realSrc = fallbackSrc) : null} />
