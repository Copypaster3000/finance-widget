<script lang="ts">
  import type { BuyEvent, LedgerAsset, LedgerEvent, LedgerEventPreviewResult, LedgerMutationError, LedgerPositionState, Quote, SellEvent, TransactionPriceResolution } from '../lib/types';
  import { buildTradeEvent, effectiveUnitPrice, hasDecimalInput } from '../lib/transactions';
  import { isNegativeAccountAdjustment, nextSequence } from '../lib/ledger';
  import { formatQuantity, money, signedMoney } from '../lib/format';
  import Icon from './Icon.svelte';
  import { localCalendarDate } from '../lib/calendar';

  export let asset: LedgerAsset;
  export let position: LedgerPositionState;
  export let quote: Quote | undefined;
  export let events: LedgerEvent[];
  export let initialEventId = '';
  export let debtRowVisible = true;
  export let privacyHidden = false;
  export let onBack: () => void;
  export let onSave: (event: LedgerEvent) => Promise<LedgerMutationError | undefined>;
  export let onSaveRemovingAdjustments: (event: LedgerEvent, adjustmentIds: string[]) => Promise<LedgerMutationError | undefined>;
  export let onDelete: (eventId: string) => Promise<LedgerMutationError | undefined>;
  export let onOpenEvent: (eventId: string) => void;
  export let resolvePrice: (asset: LedgerAsset, date: string) => Promise<TransactionPriceResolution>;
  export let previewEvent: (event: LedgerEvent) => LedgerEventPreviewResult;

  type Screen = 'detail' | 'buy' | 'sell';
  let screen: Screen = 'detail';
  let editing: LedgerEvent | undefined;
  let date = today();
  let quantity: string | number = '';
  let mode: 'unit' | 'total' = 'unit';
  let unitPrice: string | number = '';
  let totalAmount: string | number = '';
  let fees: string | number = '0';
  let affectsCashDebt = true;
  let error = '';
  let working = false;
  let pendingPrice: TransactionPriceResolution | undefined;
  let deleteTarget: LedgerEvent | undefined;
  let deleteError: LedgerMutationError | undefined;
  let saveError: LedgerMutationError | undefined;
  let blockedDraft: LedgerEvent | undefined;
  let openedInitial = '';

  $: assetEvents = events.filter((event): event is BuyEvent | SellEvent => (event.eventType === 'buy' || event.eventType === 'sell') && event.assetId === asset.id).sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
  $: marketValue = quote ? position.quantity * quote.price : undefined;
  $: unrealized = marketValue !== undefined && position.remainingCostBasis !== undefined ? marketValue - position.remainingCostBasis : undefined;
  $: previewTotal = mode === 'unit' && Number(quantity) > 0 && Number(unitPrice) > 0
    ? Number(quantity) * Number(unitPrice) + (screen === 'buy' ? Number(fees || 0) : -Number(fees || 0))
    : Number(totalAmount);
  $: previewResult = transactionPreview(screen, editing, date, quantity, mode, unitPrice, totalAmount, fees, affectsCashDebt, events);
  $: consequence = previewResult?.preview;
  $: saveBlockers = blockingEvents(saveError);
  $: removableSaveBlockers = saveBlockers.filter(isNegativeAccountAdjustment);
  $: canRemoveRedundantAdjustments = Boolean(editing && !affectsCashDebt && saveError && saveBlockers.length && removableSaveBlockers.length === saveBlockers.length);
  $: if (initialEventId && initialEventId !== openedInitial) {
    openedInitial = initialEventId;
    const source = assetEvents.find((event) => event.id === initialEventId);
    if (source) startTrade(source.eventType, source);
  }

  function today() {
    return localCalendarDate();
  }
  function resetForm() { editing = undefined; date = today(); quantity = ''; mode = 'unit'; unitPrice = ''; totalAmount = ''; fees = '0'; affectsCashDebt = true; error = ''; pendingPrice = undefined; deleteTarget = undefined; deleteError = undefined; saveError = undefined; blockedDraft = undefined; }
  function clearSaveFailure() { saveError = undefined; blockedDraft = undefined; error = ''; pendingPrice = undefined; }
  function startTrade(side: 'buy' | 'sell', event?: BuyEvent | SellEvent) {
    resetForm(); screen = side;
    if (event) {
      editing = event; date = event.date; quantity = event.quantity; fees = event.fees;
      mode = event.priceSource === 'manual_total' ? 'total' : 'unit';
      unitPrice = event.unitPrice ?? ''; totalAmount = event.totalAmount ?? ''; affectsCashDebt = event.affectsCashDebt;
    }
  }
  function cancelForm() { screen = 'detail'; resetForm(); }
  function transactionPreview(currentScreen: Screen, currentEditing: LedgerEvent | undefined, currentDate: string, currentQuantity: string | number, currentMode: 'unit' | 'total', currentUnitPrice: string | number, currentTotalAmount: string | number, currentFees: string | number, currentAffectsCashDebt: boolean, currentEvents: LedgerEvent[]): LedgerEventPreviewResult | undefined {
    if ((currentScreen !== 'buy' && currentScreen !== 'sell') || !hasDecimalInput(currentQuantity)) return undefined;
    const authoritative = currentMode === 'unit' ? currentUnitPrice : currentTotalAmount;
    if (!hasDecimalInput(authoritative)) return undefined;
    const result = buildTradeEvent({
      id: currentEditing?.id ?? '__preview__', side: currentScreen, assetId: asset.id, date: currentDate,
      sequence: currentEditing?.sequence ?? nextSequence(currentEvents, currentDate), quantity: currentQuantity, mode: currentMode, unitPrice: currentUnitPrice, totalAmount: currentTotalAmount, fees: currentFees, affectsCashDebt: currentAffectsCashDebt,
      priceSource: currentEditing && 'priceSource' in currentEditing ? currentEditing.priceSource : undefined,
      createdAt: currentEditing?.createdAt ?? 'preview'
    }, today(), 'preview');
    return result.event ? previewEvent(result.event) : undefined;
  }

  async function finishTrade(resolution?: TransactionPriceResolution) {
    const side = screen as 'buy' | 'sell';
    const useResolved = resolution !== undefined;
    const result = buildTradeEvent({
      id: editing?.id,
      side,
      assetId: asset.id,
      date,
      sequence: editing?.sequence ?? nextSequence(events, date),
      quantity,
      mode: useResolved ? 'unit' : mode,
      unitPrice: useResolved ? resolution.unitPrice : unitPrice,
      totalAmount,
      fees: useResolved ? '0' : fees,
      affectsCashDebt,
      priceSource: resolution?.source,
      createdAt: editing?.createdAt
    }, today());
    if (!result.event) { error = result.error ?? 'INVALID TRANSACTION'; return; }
    if (resolution) { result.event.priceDate = resolution.priceDate; result.event.marketTimestamp = resolution.marketTimestamp; }
    working = true;
    const failure = await onSave(result.event); saveError = failure; blockedDraft = failure ? result.event : undefined; error = '';
    working = false;
    if (!failure) cancelForm();
  }

  async function saveRemovingAdjustments() {
    if (!blockedDraft || !canRemoveRedundantAdjustments) return;
    working = true;
    const failure = await onSaveRemovingAdjustments(blockedDraft, removableSaveBlockers.map((event) => event.id));
    saveError = failure;
    working = false;
    if (!failure) cancelForm();
  }

  async function submitTrade() {
    error = ''; saveError = undefined; pendingPrice = undefined;
    const authoritative = mode === 'unit' ? unitPrice : totalAmount;
    if (hasDecimalInput(authoritative)) { await finishTrade(); return; }
    if (!date || !quantity) { error = 'DATE AND QUANTITY ARE REQUIRED'; return; }
    working = true;
    try {
      const resolution = await resolvePrice(asset, date);
      if (resolution.requiresConfirmation) pendingPrice = resolution;
      else await finishTrade(resolution);
    } catch (reason) { error = reason instanceof Error ? reason.message : 'PRICE LOOKUP FAILED'; }
    finally { working = false; }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    working = true; const failure = await onDelete(deleteTarget.id); working = false;
    if (failure) deleteError = failure;
    else { deleteTarget = undefined; deleteError = undefined; cancelForm(); }
  }

  function beginDelete(event: LedgerEvent) { deleteTarget = event; deleteError = undefined; error = ''; }
  function blockingEvents(failure: LedgerMutationError | undefined) { return (failure?.blockingEventIds ?? []).flatMap((id) => events.find((event) => event.id === id) ?? []); }
  function blockingLabel(event: LedgerEvent) { return `${event.date.slice(5).replace('-', '.')} / ${event.eventType.replaceAll('_', ' ').toUpperCase()}`; }

  function eventLabel(event: LedgerEvent): string {
    return event.eventType.toUpperCase();
  }
  function eventPrice(event: BuyEvent | SellEvent): string {
    if (event.unitPrice && Number(event.unitPrice) > 0) return `@ ${money.format(Number(event.unitPrice))}`;
    return event.priceSource === 'legacy_unknown' ? 'UNKNOWN BASIS' : '';
  }
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && (screen === 'detail' ? onBack() : cancelForm())}/>
<main class="detail-view">
  <div class="detail-heading"><button class="detail-back" on:click={screen === 'detail' ? onBack : cancelForm}><Icon name="back" size={13}/> {screen === 'detail' ? 'PORTFOLIO' : asset.symbol}</button><span>{screen === 'detail' ? 'POSITION' : screen.toUpperCase()}</span></div>

  {#if screen === 'detail'}
    <section class="detail-card position-summary">
      <div class="detail-code">{asset.symbol} / {asset.type === 'stock' ? 'EQUITY' : 'CRYPTO'}</div>
      <div class="detail-quantity">{privacyHidden ? '*****' : formatQuantity(position.quantity, asset.type)} {asset.type === 'stock' ? 'SHARES' : asset.symbol}</div>
      <div class="metric-grid">
        <span>MARKET VALUE<strong>{privacyHidden ? '******' : marketValue === undefined ? '—' : money.format(marketValue)}</strong></span>
        <span>AVG COST<strong>{privacyHidden ? '******' : position.averageCost === undefined ? 'HISTORY NEEDED' : money.format(position.averageCost)}</strong></span>
        <span>COST BASIS<strong>{privacyHidden ? '******' : position.remainingCostBasis === undefined ? '—' : money.format(position.remainingCostBasis)}</strong></span>
        <span>UNREALIZED<strong class:negative={(unrealized ?? 0) < 0}>{privacyHidden ? '******' : unrealized === undefined ? '—' : signedMoney(unrealized)}</strong></span>
        <span>REALIZED<strong class:negative={(position.realizedGain ?? 0) < 0}>{privacyHidden ? '******' : position.realizedGain === undefined ? '—' : signedMoney(position.realizedGain)}</strong></span>
      </div>
      <p class="form-hint position-kind-note">Each Buy or Sell can independently include or exclude tracked Cash and Debt.</p>
      <div class="detail-actions"><button on:click={() => startTrade('buy')}>+ BUY</button><button on:click={() => startTrade('sell')}>+ SELL</button></div>
    </section>

    {#if error}<p class="form-error">{error}</p>{/if}
    <section class="transaction-section">
      <div class="transaction-heading"><span>TRANSACTIONS</span><i>{assetEvents.length.toString().padStart(2, '0')} EVENTS</i></div>
      <div class="transaction-list">
        {#each assetEvents as item (item.id)}
          <button class="transaction-row" on:click={() => startTrade(item.eventType, item)}>
            <span>{item.date.slice(5).replace('-', '.')}</span><b>{eventLabel(item)}</b><strong>{'quantity' in item ? `${item.eventType === 'sell' ? '-' : '+'}${item.quantity}` : ''}</strong><i>{eventPrice(item)}</i>
          </button>
        {:else}<div class="detail-empty">NO TRANSACTIONS</div>{/each}
      </div>
    </section>
  {:else if screen === 'buy' || screen === 'sell'}
    <section class="detail-card entry-card" on:input={clearSaveFailure} on:change={clearSaveFailure}>
      <div class="detail-code">{editing ? 'EDIT' : 'ADD'} {screen.toUpperCase()}</div>
      <div class="form-grid"><label>DATE<input type="date" max={today()} bind:value={date}/></label><label>QUANTITY<input type="text" inputmode="decimal" bind:value={quantity}/></label></div>
      <span class="setting-label">{screen === 'buy' ? 'COST INPUT' : 'VALUE INPUT'}</span>
      <div class="segmented"><button aria-pressed={mode === 'unit'} class:active={mode === 'unit'} on:click={() => mode = 'unit'}>PRICE / UNIT</button><button aria-pressed={mode === 'total'} class:active={mode === 'total'} on:click={() => mode = 'total'}>{screen === 'buy' ? 'TOTAL PAID' : 'TOTAL PROCEEDS'}</button></div>
      {#if mode === 'unit'}
        <div class="form-grid"><label>PRICE / UNIT<input type="text" inputmode="decimal" placeholder="AUTO IF BLANK" bind:value={unitPrice}/></label><label>FEES<input type="text" inputmode="decimal" bind:value={fees}/></label></div>
      {:else}
        <label>{screen === 'buy' ? 'TOTAL PAID / FEES INCLUDED' : 'NET PROCEEDS / AFTER FEES'}<input type="text" inputmode="decimal" placeholder="AUTO IF BLANK" bind:value={totalAmount}/></label>
        {#if effectiveUnitPrice(totalAmount, quantity)}<p class="form-hint">EFFECTIVE UNIT {money.format(Number(effectiveUnitPrice(totalAmount, quantity)))}</p>{/if}
      {/if}
      <label class="account-impact-toggle"><input type="checkbox" bind:checked={affectsCashDebt}/><span class="account-impact-check" aria-hidden="true">{#if affectsCashDebt}<Icon name="check" size={10}/>{/if}</span><span class="account-impact-copy"><b>{screen === 'buy' ? 'USE TRACKED CASH / DEBT' : 'APPLY PROCEEDS TO CASH / DEBT'}</b><i>{affectsCashDebt ? (screen === 'buy' ? 'Cash first, then Margin Debt.' : 'Debt first, then remaining Cash.') : 'This transaction changes holdings and gains only.'}</i></span></label>
      {#if Number.isFinite(previewTotal) && previewTotal > 0}<div class="calculated-total"><span>{screen === 'buy' ? 'TOTAL PAID' : 'NET PROCEEDS'}</span><strong>{money.format(previewTotal)}</strong></div>{/if}
      {#if consequence}<div class="consequence-preview"><span>{screen === 'buy' ? 'FUNDING' : 'PROCEEDS'}</span>
        {#if consequence.cashDelta === 0 && consequence.debtDelta === 0}<p><i>NO CASH / DEBT CHANGE</i></p>{/if}
        {#if screen === 'buy' && consequence.cashDelta < 0}<p><i>CASH</i><b>{signedMoney(consequence.cashDelta)}</b></p>{/if}
        {#if screen === 'buy' && consequence.debtDelta > 0}<p><i>MARGIN DEBT</i><b>+{money.format(consequence.debtDelta)}</b></p>{/if}
        {#if screen === 'sell' && consequence.debtDelta < 0}<p><i>DEBT PAYDOWN</i><b>−{money.format(Math.abs(consequence.debtDelta))}</b></p>{/if}
        {#if screen === 'sell' && consequence.cashDelta > 0}<p><i>TO CASH</i><b>+{money.format(consequence.cashDelta)}</b></p>{/if}
      </div>{/if}
      {#if screen === 'buy' && consequence?.debtDelta && consequence.debtDelta > 0 && !debtRowVisible}<p class="form-hint hidden-account-note">MARGIN DEBT WILL BE INCLUDED IN NET VALUE. ITS PORTFOLIO ROW IS HIDDEN IN SETTINGS.</p>{/if}
      {#if previewResult && !previewResult.preview}<p class="form-hint">{editing && !affectsCashDebt ? 'CASH / DEBT REVIEW REQUIRED — Save will review later conflicting account adjustments.' : `PREVIEW UNAVAILABLE / ${previewResult.issues[0]?.message ?? 'INVALID DRAFT'}`}</p>{/if}
      {#if pendingPrice}<div class="price-confirm"><span>{pendingPrice.source === 'stale_quote_confirmed' ? 'STALE PRICE / CONFIRM BEFORE SAVING' : 'PREVIOUS CLOSE / CONFIRM PRICE'}</span><strong>{pendingPrice.priceDate} / {money.format(Number(pendingPrice.unitPrice))}</strong><div><button on:click={() => void finishTrade(pendingPrice)}>USE THIS PRICE</button><button on:click={() => { pendingPrice = undefined; mode = 'unit'; unitPrice = ''; }}>ENTER PRICE</button></div></div>{/if}
      {#if error}<p class="form-error">{error}</p>{/if}
      {#if saveError}<div class="mutation-blocked"><strong>SAVE NOT APPLIED</strong><p>{saveError.message}</p>{#each saveBlockers as blocker}<div><span>{blockingLabel(blocker)}</span><button on:click={() => onOpenEvent(blocker.id)}>REVIEW</button></div>{/each}{#if canRemoveRedundantAdjustments}<p>Turning off tracked Cash / Debt makes {removableSaveBlockers.length === 1 ? 'this later adjustment' : 'these later adjustments'} redundant. Confirm to remove {removableSaveBlockers.length === 1 ? 'it' : 'them'} and save the trade together.</p><button class="confirm-combined" disabled={working} on:click={() => void saveRemovingAdjustments()}>SAVE + REMOVE REDUNDANT ADJUSTMENT{removableSaveBlockers.length === 1 ? '' : 'S'}</button>{/if}</div>{/if}
      <button class="apply-button full-action" disabled={working} on:click={() => void submitTrade()}><Icon name="check" size={13}/>{working ? 'WORKING' : editing ? 'SAVE TRANSACTION' : `ADD ${screen.toUpperCase()}`}</button>
      {#if editing}<button class="danger-action" on:click={() => editing && beginDelete(editing)}>DELETE TRANSACTION</button>{/if}
    </section>
  {/if}

  {#if deleteTarget}<div class="inline-confirm" class:blocked={deleteError}><span>{deleteError ? 'DELETE BLOCKED' : `DELETE ${eventLabel(deleteTarget)} ON ${deleteTarget.date}?`}</span><p>{deleteError?.message ?? 'This button performs the deletion. Save Transaction is not involved.'}</p>{#if deleteError}{#each blockingEvents(deleteError) as blocker}<div class="blocking-row"><span>{blockingLabel(blocker)}</span><button on:click={() => onOpenEvent(blocker.id)}>REVIEW</button></div>{/each}{/if}<div><button on:click={() => { deleteTarget = undefined; deleteError = undefined; }}>CANCEL</button>{#if !deleteError}<button class="confirm-delete" disabled={working} on:click={() => void confirmDelete()}>DELETE</button>{/if}</div></div>{/if}
</main>
