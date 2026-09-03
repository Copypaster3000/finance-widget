<script lang="ts">
  import type { Position } from '../lib/types';
  import type { AppearanceSettings } from '../lib/types';
  import { formatQuantity, money, signedPercent } from '../lib/format';
  import RollingNumber from './RollingNumber.svelte';
  export let position: Position;
  export let appearance: AppearanceSettings;
  export let privacyHidden = false;
  export let onOpen: () => void;
  $: isMarketAsset = position.type === 'stock' || position.type === 'crypto';
  $: typeLabel = position.type === 'crypto' ? 'CRYPTO / USD' : position.type === 'stock' ? 'EQUITY / USD' : position.type === 'cash' ? 'USD / LIQUID' : 'LIABILITY';
  function displayQuantity() { return formatQuantity(position.quantity, position.type === 'crypto' ? 'crypto' : 'stock'); }
</script>

<button type="button" class:unpriced={isMarketAsset && !position.quote} class:liability={position.type === 'debt'} class="holding-row" on:click={onOpen}>
  <div class="holding-topline">
    <div class="asset-id">
      <span class="asset-symbol">{position.symbol}</span>
      <span class="asset-type">{typeLabel}</span>
      <span class="row-disclosure">OPEN ›</span>
    </div>
    <div class="position-value">
      <strong>{#if privacyHidden}<span class="private-value">******</span>{:else}<RollingNumber value={isMarketAsset && !position.quote ? '—' : money.format(position.value)} />{/if}</strong>
      {#if appearance.showDailyChange && position.quote?.changePercent != null}<span class:negative={!privacyHidden && position.quote.changePercent < 0}>{privacyHidden ? '****' : signedPercent(position.quote.changePercent)}</span>{/if}
    </div>
  </div>
  <div class="allocation-track" aria-label={`${position.allocation.toFixed(1)} percent allocation`}>
    <div class="allocation-fill" style={`width:${Math.min(100, position.allocation)}%`}><span></span></div>
  </div>
  <div class="holding-meta">
    <span>{#if isMarketAsset && appearance.showQuantity}{privacyHidden ? '*****' : displayQuantity()} {position.type === 'stock' ? 'SHARES' : position.symbol}{:else if position.type === 'cash'}USD / LIQUID{:else if position.type === 'debt'}GROSS ASSET RATIO{/if}</span>
    <span class="meta-center">{#if isMarketAsset && appearance.showPrice && position.quote}{privacyHidden ? '@ *****' : `@ ${money.format(position.quote.price)}`}{/if}</span>
    <span>{position.allocation.toFixed(1)}%</span>
  </div>
</button>
