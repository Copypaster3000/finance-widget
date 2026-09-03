<script lang="ts">
  import HoldingRow from './HoldingRow.svelte';
  import PortfolioHistoryChart from './PortfolioHistoryChart.svelte';
  import RollingNumber from './RollingNumber.svelte';
  import type { AppearanceSettings, FeedStatus, HistoryRange, HistoryWarning, PortfolioDayChange, PortfolioHistoryPoint, PortfolioSummary, Quote } from '../lib/types';
  import { money, signedMoney, signedPercent, syncTime } from '../lib/format';
  import { feedLabel, feedTooltip, valuationLabel } from '../lib/feed';
  export let summary: PortfolioSummary;
  export let appearance: AppearanceSettings;
  export let quotes: Quote[];
  export let feed: FeedStatus;
  export let missingPrices: number;
  export let refreshing: boolean;
  export let historyPoints: PortfolioHistoryPoint[];
  export let historyRanges: HistoryRange[];
  export let historyRange: HistoryRange;
  export let onHistoryRange: (range: HistoryRange) => void;
  export let historyLoading: boolean;
  export let historyWarning: HistoryWarning | undefined;
  export let onRetryHistory: () => void;
  export let historyLive: boolean;
  export let dayChange: PortfolioDayChange | undefined;
  export let privacyHidden = false;
  export let onOpenPosition: (id: string) => void;
  export let onAddAsset: () => void;
  export let onDismissTransition: () => void;

  $: feedWarning = ['demo', 'partial', 'offline', 'unavailable'].includes(feed.state);
  $: valuationState = valuationLabel(feed, missingPrices);
  $: registeredAssetCount = summary.positions.filter((position) => position.type === 'stock' || position.type === 'crypto').length;
  $: visiblePositions = summary.positions.filter((position) => position.type === 'cash' ? appearance.showCash : position.type === 'debt' ? appearance.showDebt : true);
  $: visibleAccountBalance = (appearance.showCash ? summary.cash : 0) + (appearance.showDebt ? summary.debt : 0);
  $: emptyPortfolio = registeredAssetCount === 0 && visibleAccountBalance === 0;
  $: hiddenCash = !appearance.showCash && summary.cash !== 0;
  $: hiddenDebt = !appearance.showDebt && summary.debt !== 0;
</script>

<main class:with-history={appearance.showHistory} class="portfolio-view">
  <section class="portfolio-total">
    <div class="section-code">NET PORTFOLIO VALUE <span>01</span></div>
    <div class:update-flash={refreshing} class="total-value">{#if privacyHidden}<span class="private-value">********</span>{:else}<RollingNumber value={money.format(summary.totalValue)} />{/if}</div>
    {#if valuationState}<div class="valuation-state" class:warning={feedWarning}>{valuationState}</div>{/if}
    <div class="total-subline">
      <span>USD / {summary.investmentPositionCount.toString().padStart(2, '0')} ASSETS</span>
      {#if appearance.showDailyChange && dayChange}
        <span class:negative={!privacyHidden && dayChange.value < 0} class="daily-total" title="Change since local midnight"><span>{privacyHidden ? '******' : signedMoney(dayChange.value)}</span><b>{privacyHidden ? '****' : signedPercent(dayChange.percent)}</b></span>
      {/if}
    </div>
    {#if hiddenCash || hiddenDebt}
      <div class="net-adjustments">
        <span>NET ADJUSTMENTS</span>
        {#if hiddenCash}<button on:click={() => onOpenPosition('cash')}>CASH <b>{privacyHidden ? '******' : signedMoney(summary.cash)}</b></button>{/if}
        {#if hiddenDebt}<button on:click={() => onOpenPosition('debt')}>DEBT <b>{privacyHidden ? '******' : signedMoney(-summary.debt)}</b></button>{/if}
      </div>
    {/if}
    {#if feed.transition}
      <div class="source-transition" role="status">
        <div><span>PRICE SOURCE UPDATED</span><strong>{feed.transition.from} → {feed.transition.to}</strong></div>
        <p>PORTFOLIO REPRICED <b class:negative={feed.transition.delta < 0}>{privacyHidden ? '******' : signedMoney(feed.transition.delta)}</b></p>
        <button aria-label="Dismiss price source update" on:click={onDismissTransition}>×</button>
      </div>
    {/if}
  </section>

  {#if appearance.showHistory}<PortfolioHistoryChart points={historyPoints} ranges={historyRanges} range={historyRange} onRange={onHistoryRange} loading={historyLoading} warning={historyWarning} onRetry={onRetryHistory} live={historyLive} {privacyHidden}/>{/if}

  <div class="rule"><span></span><i>ALLOC / GROSS ASSETS</i><button class="inline-add" on:click={onAddAsset}>+ ASSET</button></div>

  <section class="holdings-list">
    {#if emptyPortfolio}
      <div class="portfolio-onboarding">
        <span>NO ASSETS TRACKED</span><p>Add an asset or establish an account balance.</p>
        <button class="primary" on:click={onAddAsset}>+ ADD ASSET</button>
        {#if appearance.showCash}<button on:click={() => onOpenPosition('cash')}><b>CASH</b><i>SET OPENING BALANCE</i><strong>›</strong></button>{/if}
        {#if appearance.showDebt}<button on:click={() => onOpenPosition('debt')}><b>MARGIN DEBT</b><i>TRACK EXISTING DEBT</i><strong>›</strong></button>{/if}
      </div>
    {:else}
      {#each visiblePositions as position (position.id)}
        <HoldingRow {position} {appearance} {privacyHidden} onOpen={() => onOpenPosition(position.id)} />
      {/each}
    {/if}
  </section>

  <footer class="status-deck">
    <div class="status-left">
      <span class:warning={feedWarning} class="signal" title={feedTooltip(feed, quotes)}><i></i>{feedLabel(feed)}</span>
    </div>
    <div class="updated"><span>CHECKED</span><strong>{feed.lastCheckedAt ? syncTime(feed.lastCheckedAt) : 'NOT YET'}</strong></div>
  </footer>
</main>
