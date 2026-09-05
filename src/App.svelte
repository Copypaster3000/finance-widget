<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PhysicalSize } from '@tauri-apps/api/dpi';
  import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { exit } from '@tauri-apps/plugin-process';
  import AccountDetailPanel from './components/AccountDetailPanel.svelte';
  import AddAssetPanel from './components/AddAssetPanel.svelte';
  import AssetDetailPanel from './components/AssetDetailPanel.svelte';
  import Header from './components/Header.svelte';
  import PortfolioView from './components/PortfolioView.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import { localCalendarDate } from './lib/calendar';
  import { DEFAULT_CONFIG } from './lib/defaults';
  import { detectPriceSourceTransition, mergeIncomingQuotes, missingQuoteCount, preferredStoredQuotes, resolveFeedState, summarizeHistoryErrors } from './lib/feed';
  import { cachedSeries, shiftDate, syncHistoricalCache } from './lib/history';
  import { availableHistoryRanges, chartHistory, completedHour, EMPTY_HOURLY_CACHE, portfolioChangeSinceLocalMidnight, recordRecentPortfolio } from './lib/hourly';
  import { deleteLedgerEvent, emptyLedger, ledgerHoldings, previewLedgerEvent, replayLedger, updateLedgerEvent, updateLedgerEventRemovingAdjustments } from './lib/ledger';
  import { calculateLedgerHistory, EMPTY_LEDGER_PRICE_CACHE, syncLedgerPriceCache } from './lib/ledgerHistory';
  import { isUsEquityExtendedSessionOpen, isUsEquityMarketOpen } from './lib/market';
  import { calculateLedgerPortfolio } from './lib/portfolio';
  import { createProvider } from './lib/providers';
  import { loadState, saveConfig, saveHistoryCache, saveHourlyHistory, saveLedger, saveLedgerState, saveLedgerPriceCache, saveQuotes } from './lib/storage';
  import type { AccountActivity, AppConfig, AssetType, FeedStatus, HistoricalCache, HistoryRange, LedgerAsset, LedgerEvent, LedgerEventPreviewResult, LedgerMutationError, LedgerPriceCache, PortfolioHourlyCache, PortfolioLedger, Quote, RefreshMode, TransactionPriceResolution } from './lib/types';

  type View = 'portfolio' | 'settings' | 'asset' | 'cash' | 'debt' | 'new-asset';
  let config: AppConfig = structuredClone(DEFAULT_CONFIG);
  let ledger: PortfolioLedger = emptyLedger();
  let quotes: Quote[] = [];
  let historicalCache: HistoricalCache = {};
  let ledgerPriceCache: LedgerPriceCache = structuredClone(EMPTY_LEDGER_PRICE_CACHE);
  let hourlyHistory: PortfolioHourlyCache = structuredClone(EMPTY_HOURLY_CACHE);
  let view: View = 'portfolio';
  let selectedAssetId = '';
  let selectedEventId = '';
  let privacyHidden = false;
  let refreshing = false;
  let ready = false;
  let storageUnavailable = false;
  let storageDetail = '';
  let storageRetrying = false;
  let appMounted = false;
  let feed: FeedStatus = { state: 'idle', lastCheckedAt: 0, lastQuoteReceivedAt: 0 };
  let historyLoading = false;
  let historyErrors: string[] = [];
  let historyRequest = 0;
  let historyAttemptedThrough = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let dayBoundaryTimer: ReturnType<typeof setTimeout> | undefined;
  let clockNow = Date.now();
  let windowPixels = { width: 474, height: 700 };
  let windowScale = 1;
  let resizeState: { pointerId: number; target: HTMLElement; startX: number; startY: number; width: number; height: number } | undefined;

  $: replay = replayLedger(ledger);
  $: account = replay.state;
  $: holdings = ledgerHoldings(ledger);
  $: summary = calculateLedgerPortfolio(account, quotes);
  $: missingPrices = missingQuoteCount(quotes, holdings);
  $: historyWarning = summarizeHistoryErrors(historyErrors);
  $: resolvedHistoryStart = resolveHistoryStart(config, ledger);
  $: completedHistory = calculateLedgerHistory(ledger, ledgerPriceCache, resolvedHistoryStart, new Date(clockNow).toISOString(), config.historyStartMode);
  $: chartCache = { ...hourlyHistory, points: completedHistory };
  $: historyRanges = availableHistoryRanges(chartCache, clockNow);
  $: activeHistoryRange = historyRanges.includes(config.appearance.historyRange) ? config.appearance.historyRange : 'all';
  $: historyPoints = chartHistory(chartCache, summary.totalValue, clockNow, 480, activeHistoryRange);
  $: dayChange = portfolioChangeSinceLocalMidnight([...completedHistory, ...hourlyHistory.recentPoints], summary.totalValue, clockNow);
  $: selectedAsset = ledger.assets.find((asset) => asset.id === selectedAssetId);
  $: selectedPosition = account.positions.find((position) => position.asset.id === selectedAssetId);
  $: selectedQuote = selectedAsset ? quotes.find((quote) => quote.assetType === selectedAsset.type && quote.symbol === selectedAsset.symbol) : undefined;
  $: accent = config.appearance.accent;
  $: textScale = config.appearance.scale;
  $: panelStyle = [
    `--panel-opacity:${config.appearance.opacity}`,
    `--font-micro:clamp(${8 * textScale}px,${1.9 * textScale}cqw,${9 * textScale}px)`,
    `--font-small:clamp(${9 * textScale}px,${2.2 * textScale}cqw,${10 * textScale}px)`,
    `--font-label:clamp(${10 * textScale}px,${2.45 * textScale}cqw,${11 * textScale}px)`,
    `--font-change:clamp(${9 * textScale}px,${2.35 * textScale}cqw,${11 * textScale}px)`,
    `--font-value:clamp(${13 * textScale}px,${3.4 * textScale}cqw,${16 * textScale}px)`,
    `--font-total:clamp(${18 * textScale}px,${8.4 * textScale}cqw,${42 * textScale}px)`
  ].join(';');

  const intervals: Partial<Record<RefreshMode, number>> = { '1h': 3_600_000, '15m': 900_000, '15s': 15_000 };

  function today(): string { return localCalendarDate(); }
  function earliestBuyDate(targetLedger: PortfolioLedger): string | undefined {
    return targetLedger.events.filter((event) => event.eventType === 'buy').map((event) => event.date).sort()[0];
  }
  function resolveHistoryStart(targetConfig: AppConfig, targetLedger: PortfolioLedger): string {
    return targetConfig.historyStartMode === 'manual' ? targetConfig.historyStartDate : earliestBuyDate(targetLedger) ?? targetConfig.historyStartDate;
  }
  function isStockSessionActive(targetConfig: AppConfig): boolean { return targetConfig.stockSession === 'extended' ? isUsEquityExtendedSessionOpen() : isUsEquityMarketOpen(); }
  function schedule(mode: RefreshMode) { if (timer) clearInterval(timer); timer = undefined; const interval = intervals[mode]; if (interval) timer = setInterval(() => void refresh(), interval); }
  function scheduleDayBoundary() { if (dayBoundaryTimer) clearTimeout(dayBoundaryTimer); const nextMidnight = new Date(); nextMidnight.setHours(24, 0, 0, 0); dayBoundaryTimer = setTimeout(() => { clockNow = Date.now(); scheduleDayBoundary(); }, Math.max(1, nextMidnight.getTime() - Date.now() + 50)); }

  async function refreshHistory(targetLedger = ledger, targetConfig = config, force = false) {
    const targetHour = completedHour();
    if (!force && historyAttemptedThrough === targetHour) return;
    historyAttemptedThrough = targetHour;
    const request = ++historyRequest; historyLoading = true;
    try {
      if (targetLedger.assets.length) {
        const result = await syncLedgerPriceCache(createProvider(targetConfig.stockSession === 'extended'), targetLedger, ledgerPriceCache, resolveHistoryStart(targetConfig, targetLedger), targetHour);
        if (request !== historyRequest) return;
        ledgerPriceCache = result.cache; historyErrors = result.errors;
        if (result.changed) await saveLedgerPriceCache(ledgerPriceCache);
      } else historyErrors = [];
    } catch (error) { if (request !== historyRequest) return; historyErrors = [error instanceof Error ? error.message : 'Historical provider error']; }
    finally { if (request === historyRequest) historyLoading = false; }
  }

  async function refresh(forceStocks = false) {
    if (refreshing) return;
    refreshing = true;
    feed = { ...feed, state: 'updating' };
    const previousQuotes = quotes;
    const previousValue = calculateLedgerPortfolio(replayLedger(ledger).state, previousQuotes).totalValue;
    const checkedAt = Date.now();
    try {
      const provider = createProvider(config.stockSession === 'extended');
      const stockSessionActive = isStockSessionActive(config);
      const requested = holdings.filter((holding) => holding.type === 'crypto' || forceStocks || stockSessionActive);
      const result = requested.length ? await provider.getQuotes(requested) : { quotes: [], errors: [] };
      if (result.quotes.length) {
        const nextQuotes = mergeIncomingQuotes(quotes, result.quotes, holdings);
        const nextValue = calculateLedgerPortfolio(replayLedger(ledger).state, nextQuotes).totalValue;
        const transition = detectPriceSourceTransition(previousValue, nextValue, previousQuotes, result.quotes, checkedAt);
        quotes = nextQuotes;
        await saveQuotes(quotes); clockNow = checkedAt;
        if (config.refreshMode === '15s' || config.refreshMode === '15m') { hourlyHistory = recordRecentPortfolio(hourlyHistory, nextValue, checkedAt); await saveHourlyHistory(hourlyHistory); }
        feed = { ...feed, provider: result.quotes[0]?.provider ?? provider.name, lastQuoteReceivedAt: checkedAt, transition: transition ?? feed.transition };
      }
      const hasStocks = holdings.some((holding) => holding.type === 'stock');
      const hasCrypto = holdings.some((holding) => holding.type === 'crypto');
      const missing = missingQuoteCount(quotes, holdings);
      const state = resolveFeedState({ holdingCount: holdings.length, hasStocks, hasCrypto, stockSessionActive, errorCount: result.errors.length, receivedCount: result.quotes.length, availableCount: holdings.length - missing, hasLive: result.quotes.some((quote) => quote.status === 'live') });
      feed = { ...feed, state, provider: result.quotes[0]?.provider ?? feed.provider, lastCheckedAt: checkedAt, detail: result.errors.join(' / ') || undefined };
      void refreshHistory();
    } catch (error) {
      feed = { ...feed, state: quotes.length ? 'offline' : 'unavailable', lastCheckedAt: checkedAt, detail: error instanceof Error ? error.message : 'Price refresh failed' };
    }
    finally { refreshing = false; }
  }

  async function applyConfig(next: AppConfig) {
    if (next.historyStartMode === 'auto') next = { ...next, historyStartDate: earliestBuyDate(ledger) ?? next.historyStartDate };
    const startupChanged = next.launchAtStartup !== config.launchAtStartup;
    const historyChanged = next.historyStartDate !== config.historyStartDate || next.historyStartMode !== config.historyStartMode;
    const nextPrices = historyChanged ? structuredClone(EMPTY_LEDGER_PRICE_CACHE) : ledgerPriceCache;
    await saveLedgerState(ledger, next, hourlyHistory, nextPrices);
    config = next; ledgerPriceCache = nextPrices; view = 'portfolio'; historyAttemptedThrough = ''; schedule(config.refreshMode);
    try { await getCurrentWindow().setAlwaysOnTop(config.windowMode === 'alwaysOnTop'); await getCurrentWindow().setSkipTaskbar(!config.showInTaskbar); if (startupChanged) { const enabled = await isEnabled(); if (config.launchAtStartup && !enabled) await enable(); if (!config.launchAtStartup && enabled) await disable(); } } catch { /* preview */ }
    await refresh(true);
  }

  function mutationError(issues: { eventId?: string; message: string }[], proposedEventId?: string): LedgerMutationError {
    return { message: issues[0]?.message ?? 'LEDGER MUTATION IS INVALID', blockingEventIds: [...new Set(issues.flatMap((issue) => issue.eventId && issue.eventId !== proposedEventId ? [issue.eventId] : []))] };
  }
  async function persistLedgerMutation(nextLedger: PortfolioLedger) {
    const previousHistoryStart = resolveHistoryStart(config, ledger);
    const nextConfig = config.historyStartMode === 'auto' ? { ...config, historyStartDate: earliestBuyDate(nextLedger) ?? config.historyStartDate } : config;
    const nextHourly = { ...hourlyHistory, recentPoints: [] };
    const nextPrices = resolveHistoryStart(nextConfig, nextLedger) < previousHistoryStart ? structuredClone(EMPTY_LEDGER_PRICE_CACHE) : ledgerPriceCache;
    await saveLedgerState(nextLedger, nextConfig, nextHourly, nextPrices);
    ledger = nextLedger; config = nextConfig; hourlyHistory = nextHourly; ledgerPriceCache = nextPrices; historyAttemptedThrough = '';
    void refresh(true);
  }
  async function saveEvent(event: LedgerEvent): Promise<LedgerMutationError | undefined> {
    const result = updateLedgerEvent(ledger, event, today());
    if (!result.ledger) return mutationError(result.issues, event.id);
    try { await persistLedgerMutation(result.ledger); return undefined; }
    catch (error) { return { message: `Save failed: ${String(error)}`, blockingEventIds: [] }; }
  }
  async function saveEventRemovingAdjustments(event: LedgerEvent, adjustmentIds: string[]): Promise<LedgerMutationError | undefined> {
    const result = updateLedgerEventRemovingAdjustments(ledger, event, adjustmentIds, today());
    if (!result.ledger) return mutationError(result.issues, event.id);
    try { await persistLedgerMutation(result.ledger); return undefined; }
    catch (error) { return { message: `Save failed: ${String(error)}`, blockingEventIds: [] }; }
  }
  function previewEvent(event: LedgerEvent): LedgerEventPreviewResult {
    return previewLedgerEvent(ledger, event, today());
  }
  async function removeEvent(eventId: string): Promise<LedgerMutationError | undefined> {
    const result = deleteLedgerEvent(ledger, eventId, today());
    if (!result.ledger) return mutationError(result.issues, eventId);
    try { await persistLedgerMutation(result.ledger); return undefined; }
    catch (error) { return { message: `Save failed: ${String(error)}`, blockingEventIds: [] }; }
  }
  async function addAsset(symbol: string, type: AssetType): Promise<string | undefined> {
    if (ledger.assets.some((asset) => asset.type === type && asset.symbol === symbol)) return 'ASSET ALREADY EXISTS';
    const id = crypto.randomUUID(); const holding = { id, symbol, type, quantity: 1 };
    try {
      const result = await createProvider(config.stockSession === 'extended').getQuotes([holding]); const quote = result.quotes[0];
      if (!quote) return result.errors[0] ?? 'SYMBOL COULD NOT BE RESOLVED';
      const asset: LedgerAsset = { id, symbol, type, createdAt: new Date().toISOString() };
      const nextLedger = { ...ledger, assets: [...ledger.assets, asset] };
      await saveLedger(nextLedger); ledger = nextLedger; quotes = [quote, ...quotes];
      selectedAssetId = id; view = 'asset'; void saveQuotes(quotes).catch(() => undefined); return undefined;
    } catch (error) { return error instanceof Error ? error.message : 'SYMBOL VALIDATION FAILED'; }
  }
  async function resolveTransactionPrice(asset: LedgerAsset, date: string): Promise<TransactionPriceResolution> {
    const holding = { id: asset.id, symbol: asset.symbol, type: asset.type, quantity: 1 };
    if (date === today()) {
      let quote = quotes.find((candidate) => candidate.assetType === asset.type && candidate.symbol === asset.symbol);
      if (!quote) quote = (await createProvider(config.stockSession === 'extended').getQuotes([holding])).quotes[0];
      if (quote) return { unitPrice: String(quote.price), source: 'current_quote', priceDate: date, requiresConfirmation: false };
    }
    const start = asset.type === 'stock' ? shiftDate(date, -10) : date;
    const synced = await syncHistoricalCache(createProvider(config.stockSession === 'extended'), 'yahoo', [holding], historicalCache, start, date);
    historicalCache = synced.cache; if (synced.changed) await saveHistoryCache(historicalCache);
    const points = cachedSeries(historicalCache, 'yahoo', [holding])[0]?.points ?? [];
    const exact = points.find((point) => point.date === date);
    if (exact) return { unitPrice: String(exact.price), source: 'historical_close', priceDate: date, requiresConfirmation: false };
    const previous = points.filter((point) => point.date < date).at(-1);
    if (asset.type === 'stock' && previous) return { unitPrice: String(previous.price), source: 'previous_trading_close', priceDate: previous.date, requiresConfirmation: true };
    throw new Error(asset.type === 'stock' ? 'NO PRIOR TRADING CLOSE WAS AVAILABLE' : `NO CRYPTO DAILY PRICE WAS AVAILABLE FOR ${date}`);
  }

  function openPosition(id: string) { selectedEventId = ''; if (id === 'cash' || id === 'debt') view = id; else { selectedAssetId = id; view = 'asset'; } }
  function openAccountSource(activity: AccountActivity) {
    selectedEventId = activity.sourceEventId;
    if (activity.sourceView === 'asset' && activity.assetId) { selectedAssetId = activity.assetId; view = 'asset'; }
    else if (activity.sourceView === 'cash' || activity.sourceView === 'debt') view = activity.sourceView;
  }
  function openLedgerEvent(eventId: string) {
    const event = ledger.events.find((candidate) => candidate.id === eventId);
    if (!event) return;
    selectedEventId = event.id;
    if ('assetId' in event) { selectedAssetId = event.assetId; view = 'asset'; }
    else view = event.eventType.startsWith('cash_') ? 'cash' : 'debt';
  }
  function backToPortfolio() { view = 'portfolio'; selectedAssetId = ''; selectedEventId = ''; }
  function setHistoryRange(range: HistoryRange) { config = { ...config, appearance: { ...config.appearance, historyRange: range } }; void saveConfig(config); }
  async function closeWindow() { try { await exit(0); } catch { window.close(); } }
  function beginResize(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    resizeState = { pointerId: event.pointerId, target, startX: event.screenX, startY: event.screenY, width: windowPixels.width, height: windowPixels.height };
    event.preventDefault(); event.stopPropagation();
  }
  function continueResize(event: PointerEvent) {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const width = Math.max(120 * windowScale, resizeState.width + (event.screenX - resizeState.startX) * windowScale);
    const height = Math.max(192 * windowScale, resizeState.height + (event.screenY - resizeState.startY) * windowScale);
    void getCurrentWindow().setSize(new PhysicalSize(Math.round(width), Math.round(height)));
  }
  function endResize(event: PointerEvent) {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    if (resizeState.target.hasPointerCapture(event.pointerId)) resizeState.target.releasePointerCapture(event.pointerId);
    resizeState = undefined;
  }
  function resetWindowSize() { void getCurrentWindow().setSize(new PhysicalSize(Math.round(474 * windowScale), Math.round(700 * windowScale))); }

  async function initializeApp() {
    if (storageRetrying) return;
    storageRetrying = true;
    try {
      const state = await loadState();
      if (!appMounted) return;
      config = state.config; ledger = state.ledger; historicalCache = state.historyCache; ledgerPriceCache = state.ledgerPriceCache; hourlyHistory = state.hourlyHistory;
      const originalHistoryStart = config.historyStartDate;
      if (config.historyStartMode === 'auto') config = { ...config, historyStartDate: earliestBuyDate(ledger) ?? config.historyStartDate };
      const loadedHoldings = ledgerHoldings(state.ledger); const active = new Set(loadedHoldings.map((holding) => `${holding.type}:${holding.symbol.toUpperCase()}`));
      quotes = preferredStoredQuotes(state.quotes.filter((quote) => active.has(`${quote.assetType}:${quote.symbol}`)), loadedHoldings);
      const migrationSaves: Promise<void>[] = [];
      if (state.ledgerMigrated) migrationSaves.push(saveLedger(ledger));
      if (state.configMigrated || config.historyStartDate !== originalHistoryStart) migrationSaves.push(saveConfig(config));
      await Promise.all(migrationSaves);
      if (!appMounted) return;
      storageUnavailable = false;
      feed = { state: !loadedHoldings.length ? 'idle' : quotes.length ? 'cached' : 'unavailable', provider: quotes[0]?.provider, lastCheckedAt: 0, lastQuoteReceivedAt: 0 };
      ready = true; schedule(config.refreshMode); scheduleDayBoundary();
      try { await getCurrentWindow().setAlwaysOnTop(config.windowMode === 'alwaysOnTop'); await getCurrentWindow().setSkipTaskbar(!config.showInTaskbar); } catch { /* preview */ }
      void refresh(true);
    } catch (error) {
      if (!appMounted) return;
      storageDetail = String(error);
      storageUnavailable = true;
      ready = true;
    } finally {
      storageRetrying = false;
    }
  }

  onMount(() => {
    appMounted = true;
    const appWindow = getCurrentWindow();
    void Promise.all([appWindow.outerSize(), appWindow.scaleFactor()]).then(([size, scale]) => { windowPixels = size; windowScale = scale; });
    const stopResizeListener = appWindow.onResized(({ payload }) => { windowPixels = payload; });
    void initializeApp();
    return () => { appMounted = false; void stopResizeListener.then((unlisten) => unlisten()); if (timer) clearInterval(timer); if (dayBoundaryTimer) clearTimeout(dayBoundaryTimer); };
  });
</script>

<svelte:head><title>Finance Widget</title></svelte:head>

<div class:ready class="app-shell" data-accent={accent} style={panelStyle}>
  <div class="frame-corner tl"></div><div class="frame-corner tr"></div><div class="frame-corner bl"></div><div class="frame-corner br"></div>
  <div class="resize-grip" aria-hidden="true" title="Drag to resize; double-click to reset" on:dblclick={resetWindowSize} on:pointerdown={beginResize} on:pointermove={continueResize} on:pointerup={endResize} on:pointercancel={endResize}></div>
  <Header mode={config.refreshMode} {refreshing} context={storageUnavailable ? 'storage' : view === 'portfolio' ? 'portfolio' : view === 'settings' ? 'settings' : 'ledger'} {privacyHidden} onPrivacy={() => privacyHidden = !privacyHidden} onRefresh={() => void refresh(true)} onSettings={() => view === 'portfolio' ? (view = 'settings') : backToPortfolio()} onClose={closeWindow}/>
  {#if storageUnavailable}
    <section class="storage-unavailable">
      <span>LOCAL STORAGE / LOAD INTERRUPTED</span>
      <h2>STORAGE UNAVAILABLE</h2>
      <p>Unable to open the saved portfolio. Retry the local data connection before continuing.</p>
      <p>{storageDetail}</p>
      <button class="apply-button" disabled={storageRetrying} on:click={() => void initializeApp()}>{storageRetrying ? 'RECONNECTING' : 'RETRY LOAD'}</button>
    </section>
  {:else if view === 'settings'}
    <SettingsView {config} autoHistoryStartDate={earliestBuyDate(ledger) ?? config.historyStartDate} onApply={applyConfig} onBack={backToPortfolio}/>
  {:else if view === 'new-asset'}
    <AddAssetPanel onBack={backToPortfolio} onAdd={addAsset}/>
  {:else if view === 'asset' && selectedAsset && selectedPosition}
    <AssetDetailPanel asset={selectedAsset} position={selectedPosition} quote={selectedQuote} events={ledger.events} initialEventId={selectedEventId} debtRowVisible={config.appearance.showDebt} {privacyHidden} onBack={backToPortfolio} onSave={saveEvent} onSaveRemovingAdjustments={saveEventRemovingAdjustments} onDelete={removeEvent} onOpenEvent={openLedgerEvent} {previewEvent} resolvePrice={resolveTransactionPrice}/>
  {:else if view === 'cash' || view === 'debt'}
    <AccountDetailPanel kind={view} balance={view === 'cash' ? account.cash : account.debt} events={ledger.events} activities={replay.activities} assets={ledger.assets} initialEventId={selectedEventId} {privacyHidden} onBack={backToPortfolio} onSave={saveEvent} onDelete={removeEvent} onOpenSource={openAccountSource} onOpenEvent={openLedgerEvent} {previewEvent}/>
  {:else}
    <PortfolioView {summary} appearance={config.appearance} {quotes} {feed} {missingPrices} {refreshing} {historyPoints} {historyRanges} historyRange={activeHistoryRange} onHistoryRange={setHistoryRange} {historyLoading} {historyWarning} onRetryHistory={() => void refreshHistory(ledger, config, true)} {dayChange} {privacyHidden} historyLive={config.refreshMode !== 'manual'} onDismissTransition={() => feed = { ...feed, transition: undefined }} onOpenPosition={openPosition} onAddAsset={() => view = 'new-asset'}/>
  {/if}
</div>
