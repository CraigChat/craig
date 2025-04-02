<script>
  import { env } from '$env/dynamic/public';
</script>

<section class="flex justify-center gap-2">
  {#if env.PUBLIC_TEST_RECORDINGS}
    {#each env.PUBLIC_TEST_RECORDINGS.split(';') as pair}
      {@const [id, key] = pair.split(':')}
      <a class="inline-block rounded bg-neutral-600 p-4" href={`/rec/${id}?key=${key}`}>view recording [{id}]</a>
    {/each}
  {/if}
</section>
