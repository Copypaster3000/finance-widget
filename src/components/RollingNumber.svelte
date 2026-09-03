<script lang="ts">
  import { rollingGlyphs } from '../lib/rolling';

  export let value: string;

  let previousValue = value;
  let revision = 0;
  let characters = rollingGlyphs(value, value, revision);

  $: if (value !== previousValue) {
    revision += 1;
    characters = rollingGlyphs(value, previousValue, revision);
    previousValue = value;
  }
</script>

<span class="rolling-number" aria-label={value}>
  {#each characters as character (character.key)}
    {#if character.rolling}
      <span class="rolling-digit" aria-hidden="true">
        <span class="rolling-measure">{character.current}</span>
        <span class="rolling-clip">
          <span
            class="rolling-wheel"
            style={`--roll-start:${character.startPercent}%;--roll-end:${character.endPercent}%;--roll-duration:${character.durationMs}ms;--roll-delay:${character.delayMs}ms`}
          >
            {#each character.wheel as digit, step}
              <span style={`top:${step * 100}%`}>{digit}</span>
            {/each}
          </span>
        </span>
      </span>
    {:else}
      <span class="rolling-static" aria-hidden="true">{character.current}</span>
    {/if}
  {/each}
</span>
