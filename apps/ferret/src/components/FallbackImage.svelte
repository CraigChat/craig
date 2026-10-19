<script lang="ts">
  interface Props {
    class: string;
    src: string;
    alt: string;
    fallbackSrc?: string;
    loading?: 'eager' | 'lazy';
  }

  let { class: _class, src = $bindable(), alt, fallbackSrc = '', loading }: Props = $props();

  let realSrc = $state(src);
</script>

<img class={_class} src={realSrc} {alt} {loading} onerror={fallbackSrc ? () => (realSrc = fallbackSrc) : null} />
