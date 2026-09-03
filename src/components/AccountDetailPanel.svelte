<script lang="ts">
  import type { AccountActivity, LedgerAsset, LedgerEvent, LedgerEventPreviewResult, LedgerMutationError } from '../lib/types';
  import { nextSequence } from '../lib/ledger';
  import { normalizedMoney } from '../lib/transactions';
  import { money, signedMoney } from '../lib/format';
  import Icon from './Icon.svelte';
  import { localCalendarDate } from '../lib/calendar';

  export let kind: 'cash' | 'debt';
  export let balance: number;
  export let events: LedgerEvent[];
  export let activities: AccountActivity[];
  export let assets: LedgerAsset[];
  export let initialEventId = '';
  export let privacyHidden = false;
  export let onBack: () => void;
  export let onSave: (event: LedgerEvent) => Promise<LedgerMutationError | undefined>;
  export let onDelete: (eventId: string) => Promise<LedgerMutationError | undefined>;
  export let onOpenSource: (activity: AccountActivity) => void;
  export let onOpenEvent: (eventId: string) => void;
  export let previewEvent: (event: LedgerEvent) => LedgerEventPreviewResult;

  type Action = 'cash_opening' | 'cash_deposit' | 'cash_withdrawal' | 'cash_set' | 'cash_clear' | 'debt_opening' | 'debt_payment' | 'debt_set' | 'debt_clear';
  let action: Action | undefined;
  let editing: LedgerEvent | undefined;
  let editingActivity: AccountActivity | undefined;
  let date = today();
  let amount: string | number = '';
  let paymentSource: 'external' | 'cash' = 'external';
  let error = '';
  let working = false;
  let deleteTarget: LedgerEvent | undefined;
  let deleteError: LedgerMutationError | undefined;
  let openedInitial = '';

  $: relevant = activities.filter((activity) => activity.account === kind).sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
  $: directOpening = events.find((event) => event.eventType === `${kind}_opening`);
  $: proposed = buildEvent(action, editing, editingActivity, date, amount, paymentSource, events, balance);
  $: previewResult = proposed ? previewEvent(proposed) : undefined;
  $: consequence = previewResult?.preview;
  $: targetBalance = kind === 'cash' ? consequence?.resultingCash : consequence?.resultingDebt;
  $: if (initialEventId && initialEventId !== openedInitial) {
    openedInitial = initialEventId;
    const source = events.find((event) => event.id === initialEventId);
    if (source) startFromEvent(source);
  }

  function today() { return localCalendarDate(); }
  function actionForEvent(event: LedgerEvent): Action | undefined {
    if (event.eventType === 'cash_opening' || event.eventType === 'cash_deposit' || event.eventType === 'cash_withdrawal' || event.eventType === 'debt_opening' || event.eventType === 'debt_payment') return event.eventType;
    if (event.eventType === 'cash_adjustment') return 'cash_set';
    if (event.eventType === 'debt_adjustment') return 'debt_set';
    return undefined;
  }
  function start(next: Action, event?: LedgerEvent, activity?: AccountActivity) {
    action = next;
    editing = event;
    editingActivity = activity;
    date = event?.date ?? today();
    paymentSource = event?.eventType === 'debt_payment' ? event.source : 'external';
    if (next === 'cash_set' || next === 'debt_set') amount = activity?.balanceAfter ?? balance;
    else if (next === 'cash_clear' || next === 'debt_clear') amount = 0;
    else amount = event && 'amount' in event ? event.amount : '';
    error = '';
  }
  function startFromEvent(event: LedgerEvent) {
    const next = actionForEvent(event);
    if (!next) return;
    const activity = activities.find((item) => item.sourceEventId === event.id && item.account === kind);
    start(next, event, activity);
  }
  function openActivity(activity: AccountActivity) {
    if (activity.sourceView !== kind) { onOpenSource(activity); return; }
    const event = events.find((candidate) => candidate.id === activity.sourceEventId);
    if (event) startFromEvent(event);
  }
  function closeForm() { action = undefined; editing = undefined; editingActivity = undefined; error = ''; deleteTarget = undefined; deleteError = undefined; }
  function buildEvent(currentAction: Action | undefined, currentEditing: LedgerEvent | undefined, currentActivity: AccountActivity | undefined, currentDate: string, currentAmount: string | number, source: 'external' | 'cash', currentEvents: LedgerEvent[], currentBalance: number): LedgerEvent | undefined {
    if (!currentAction || !currentDate) return undefined;
    const isSet = currentAction === 'cash_set' || currentAction === 'cash_clear' || currentAction === 'debt_set' || currentAction === 'debt_clear';
    const normalized = normalizedMoney(currentAmount);
    if (normalized === undefined || Number(normalized) < 0) return undefined;
    const base = currentEditing ? currentActivity?.balanceBefore : currentBalance;
    let eventType: LedgerEvent['eventType'];
    let eventAmount = normalized;
    if (isSet) {
      if (base === undefined) return undefined;
      eventType = kind === 'cash' ? 'cash_adjustment' : 'debt_adjustment';
      const delta = Number(normalized) - base;
      eventAmount = normalizedMoney(delta, true) ?? '';
      if (!eventAmount || Number(eventAmount) === 0) return undefined;
    } else eventType = currentAction as LedgerEvent['eventType'];
    if (Number(eventAmount) <= 0 && eventType !== 'cash_adjustment' && eventType !== 'debt_adjustment') return undefined;
    const baseEvent = {
      id: currentEditing?.id ?? '__preview__', eventType, date: currentDate,
      sequence: currentEditing?.sequence ?? nextSequence(currentEvents, currentDate), amount: eventAmount,
      createdAt: currentEditing?.createdAt ?? 'preview', updatedAt: 'preview'
    };
    return eventType === 'debt_payment' ? { ...baseEvent, eventType, source } : baseEvent as LedgerEvent;
  }
  function actionTitle(current: Action) {
    const titles: Record<Action, string> = {
      cash_opening: 'OPENING CASH', cash_deposit: 'ADD FUNDS', cash_withdrawal: 'REMOVE FUNDS', cash_set: 'SET CASH BALANCE', cash_clear: 'CLEAR CASH',
      debt_opening: 'OPENING DEBT', debt_payment: 'PAY DOWN DEBT', debt_set: 'SET DEBT BALANCE', debt_clear: 'CLEAR DEBT'
    };
    return titles[current];
  }
  function activityLabel(item: AccountActivity) {
    const symbol = item.assetId ? assets.find((asset) => asset.id === item.assetId)?.symbol : undefined;
    if (item.reason === 'buy_funding') return `BUY${symbol ? ` / ${symbol}` : ''}`;
    if (item.reason === 'sale_proceeds') return `SELL${symbol ? ` / ${symbol}` : ''}`;
    if (item.reason === 'deposit_allocation') return item.account === 'debt' ? 'DEPOSIT / DEBT PAID' : 'FUNDS ADDED';
    if (item.reason === 'withdrawal_funding') return item.account === 'debt' ? 'WITHDRAWAL / DEBT' : 'FUNDS REMOVED';
    if (item.reason === 'debt_payment') return item.account === 'cash' ? 'DEBT PAYMENT / CASH' : 'DEBT PAYMENT';
    if (item.reason === 'opening') return 'OPENING BALANCE';
    return 'BALANCE SET';
  }
  function eventName(event: LedgerEvent) { return event.eventType.replaceAll('_', ' ').toUpperCase(); }

  async function save() {
    if (!action || !date || date > today()) { error = 'ENTER A VALID DATE'; return; }
    const preview = buildEvent(action, editing, editingActivity, date, amount, paymentSource, events, balance);
    if (!preview) { error = action.endsWith('clear') ? 'ACCOUNT IS ALREADY CLEAR' : 'ENTER A VALID POSITIVE AMOUNT'; return; }
    const now = new Date().toISOString();
    const event = { ...preview, id: editing?.id ?? crypto.randomUUID(), createdAt: editing?.createdAt ?? now, updatedAt: now } as LedgerEvent;
    working = true; const failure = await onSave(event); error = failure?.message ?? ''; working = false;
    if (!error) closeForm();
  }
  async function remove() {
    if (!deleteTarget) return;
    working = true; const failure = await onDelete(deleteTarget.id); working = false;
    if (failure) deleteError = failure;
    else closeForm();
  }
  function beginDelete(event: LedgerEvent) { deleteTarget = event; deleteError = undefined; error = ''; }
  function blockingEvents(failure: LedgerMutationError | undefined) { return (failure?.blockingEventIds ?? []).flatMap((id) => events.find((event) => event.id === id) ?? []); }
  function blockingLabel(event: LedgerEvent) { return `${event.date.slice(5).replace('-', '.')} / ${event.eventType.replaceAll('_', ' ').toUpperCase()}`; }
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && (action ? closeForm() : onBack())}/>
<main class="detail-view">
  <div class="detail-heading"><button class="detail-back" on:click={action ? closeForm : onBack}><Icon name="back" size={13}/> {action ? kind.toUpperCase() : 'PORTFOLIO'}</button><span>{kind === 'cash' ? 'CASH LEDGER' : 'LIABILITY'}</span></div>
  {#if !action}
    <section class="detail-card position-summary">
      <div class="detail-code">{kind === 'cash' ? 'CASH / USD' : 'MARGIN DEBT / LIABILITY'}</div>
      <div class="detail-quantity">{privacyHidden ? '******' : money.format(balance)} <small>{kind === 'debt' ? 'OWED' : 'AVAILABLE'}</small></div>
      <div class="detail-actions account-actions">
        {#if kind === 'cash'}
          <button on:click={() => start('cash_deposit')}>+ ADD FUNDS</button><button on:click={() => start('cash_withdrawal')}>− REMOVE</button><button on:click={() => start('cash_set')}>SET BALANCE</button>{#if balance > 0}<button class="quiet-danger" on:click={() => start('cash_clear')}>CLEAR</button>{/if}
          {#if !directOpening}<button on:click={() => start('cash_opening')}>OPENING</button>{/if}
        {:else}
          <button on:click={() => start('debt_payment')}>− PAY DOWN</button><button on:click={() => start('debt_set')}>SET BALANCE</button>{#if balance > 0}<button class="quiet-danger" on:click={() => start('debt_clear')}>CLEAR</button>{/if}
          {#if !directOpening}<button on:click={() => start('debt_opening')}>OPENING</button>{/if}
        {/if}
      </div>
    </section>
    {#if error}<p class="form-error">{error}</p>{/if}
    <section class="transaction-section">
      <div class="transaction-heading"><span>ACTIVITY</span><i>{relevant.length.toString().padStart(2,'0')} EFFECTS</i></div>
      <div class="transaction-list">
        {#each relevant as item (item.id)}
          <button class="transaction-row account-event" on:click={() => openActivity(item)} title="Open source transaction">
            <span>{item.date.slice(5).replace('-','.')}</span><b>{activityLabel(item)}</b>
            <span class:negative={item.delta < 0} class="account-delta">{privacyHidden ? '******' : signedMoney(item.delta)}</span>
            <strong>{privacyHidden ? '******' : money.format(item.balanceAfter)}</strong>
          </button>
        {:else}<div class="detail-empty">NO ACCOUNT ACTIVITY</div>{/each}
      </div>
    </section>
  {:else}
    <section class="detail-card entry-card">
      <div class="detail-code">{editing ? 'EDIT' : 'ADD'} / {actionTitle(action)}</div>
      <div class="form-grid">
        <label>DATE<input type="date" max={today()} bind:value={date}/></label>
        {#if !action.endsWith('clear')}<label>{action.includes('set') ? 'TARGET BALANCE' : 'AMOUNT'}<input type="number" step="0.01" min="0" bind:value={amount}/></label>{/if}
      </div>
      {#if action === 'debt_payment'}
        <div class="setting-block compact-setting"><span class="setting-label">PAYMENT SOURCE</span><div class="segmented"><button aria-pressed={paymentSource === 'external'} class:active={paymentSource === 'external'} on:click={() => paymentSource = 'external'}>EXTERNAL</button><button aria-pressed={paymentSource === 'cash'} class:active={paymentSource === 'cash'} on:click={() => paymentSource = 'cash'}>FROM CASH</button></div></div>
        <p class="form-hint">External payment leaves Cash unchanged. From Cash reduces both balances and requires sufficient Cash.</p>
      {:else if action === 'cash_deposit'}<p class="form-hint">Added funds pay Debt first; the remainder becomes Cash.</p>
      {:else if action === 'cash_withdrawal'}<p class="form-hint">Removed funds use Cash first; any shortfall increases Debt.</p>
      {:else if action.includes('set')}<p class="form-hint">Records a balancing entry. Earlier activity remains intact.</p>
      {:else if action.endsWith('clear')}<p class="form-hint">Records a balancing entry to zero. Earlier activity remains intact.</p>
      {:else}<p class="form-hint">Establishes the opening balance without changing the other account.</p>{/if}
      {#if consequence}
        <div class="balance-preview"><span>ACCOUNT PREVIEW</span><div><i>CURRENT</i><b>{privacyHidden ? '******' : money.format(balance)}</b></div><div><i>NEW</i><b>{privacyHidden ? '******' : money.format(targetBalance ?? balance)}</b></div><div><i>DELTA</i><b class:negative={(targetBalance ?? balance) < balance}>{privacyHidden ? '******' : signedMoney((targetBalance ?? balance) - balance)}</b></div></div>
        {#if consequence.cashDelta !== 0 && kind === 'debt'}<div class="cross-account-effect"><span>CASH EFFECT</span><b class:negative={consequence.cashDelta < 0}>{privacyHidden ? '******' : signedMoney(consequence.cashDelta)}</b></div>{/if}
        {#if consequence.debtDelta !== 0 && kind === 'cash'}<div class="cross-account-effect"><span>DEBT EFFECT</span><b class:negative={consequence.debtDelta > 0}>{privacyHidden ? '******' : signedMoney(consequence.debtDelta)}</b></div>{/if}
      {/if}
      {#if previewResult?.issues.length}<p class="form-error">{previewResult.issues[0].message.toUpperCase()}</p>{/if}
      {#if error}<p class="form-error">{error}</p>{/if}
      <button class="apply-button full-action" disabled={working || !proposed || Boolean(previewResult?.issues.length)} on:click={() => void save()}><Icon name="check" size={13}/>{editing ? 'SAVE SOURCE EVENT' : actionTitle(action)}</button>
      {#if editing}<button class="danger-action" on:click={() => editing && beginDelete(editing)}>DELETE SOURCE EVENT</button>{/if}
    </section>
  {/if}
  {#if deleteTarget}<div class="inline-confirm" class:blocked={deleteError}><span>{deleteError ? 'DELETE BLOCKED' : `DELETE ${eventName(deleteTarget)}?`}</span><p>{deleteError?.message ?? 'This button performs the deletion. Save Source Event is not involved.'}</p>{#if deleteError}{#each blockingEvents(deleteError) as blocker}<div class="blocking-row"><span>{blockingLabel(blocker)}</span><button on:click={() => onOpenEvent(blocker.id)}>REVIEW</button></div>{/each}{/if}<div><button on:click={() => { deleteTarget = undefined; deleteError = undefined; }}>CANCEL</button>{#if !deleteError}<button class="confirm-delete" disabled={working} on:click={() => void remove()}>DELETE</button>{/if}</div></div>{/if}
</main>
