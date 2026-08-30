<script lang="ts">
  import type { Component, Snippet } from 'svelte';

  interface Props {
    template: string;
    replacements: Record<string, string | Component | { html: string } | Snippet<[]>>;
  }

  let { template, replacements }: Props = $props();

  function isComponent(thing: Props['replacements'][string]): thing is Component {
    return 'name' in (thing as any) && (thing as any).name === 'Component';
  }

  function isHTML(thing: Props['replacements'][string]): thing is { html: string } {
    return 'html' in (thing as any) && typeof (thing as any).html === 'string';
  }

  function isSnippet(thing: Props['replacements'][string]): thing is Snippet<[]> {
    return typeof thing === 'function';
  }

  function parseTemplate(template: Props['template']) {
    const parts = [];
    const regex = /\{(\w+)\}/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(template)) !== null) {
      if (match.index > lastIndex) parts.push(template.slice(lastIndex, match.index));
      parts.push({ type: 'placeholder', key: match[1] });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < template.length) parts.push(template.slice(lastIndex));
    return parts;
  }

  let parsed = $derived(parseTemplate(template));
</script>

{#each parsed as part}
  {#if typeof part === 'string'}
    {part}
  {:else if part.type === 'placeholder'}
    {#if replacements[part.key]}
      {#if typeof replacements[part.key] === 'string'}
        {replacements[part.key]}
      {:else if isComponent(replacements[part.key])}
        {@const Component = replacements[part.key] as Component}
        <Component />
      {:else if isHTML(replacements[part.key])}
        {@html (replacements[part.key] as { html: string }).html}
      {:else if isSnippet(replacements[part.key])}
        {@render (replacements[part.key] as Snippet<[]>)()}
      {/if}
    {:else}
      {`{${part.key}}`}
    {/if}
  {/if}
{/each}
