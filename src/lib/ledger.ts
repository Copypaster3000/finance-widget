import { divideRounded, fixedToNumber, formatFixed, MONEY_DIGITS, parseFixed, PRICE_DIGITS, QUANTITY_DIGITS, safeNumber } from './decimal';
import { localCalendarDate } from './calendar';
import { isIsoDate } from './history';
import type {
  AccountActivity,
  AccountActivityReason,
  Holding,
  LedgerAccountState,
  LedgerAsset,
  LedgerEvent,
  LedgerEventPreview,
  LedgerEventPreviewResult,
  LedgerLotState,
  LedgerPositionState,
  LedgerReplayResult,
  LedgerValidationIssue,
  PortfolioLedger
} from './types';

const EMPTY_LEDGER: PortfolioLedger = { schemaVersion: 2, assets: [], events: [] };

type LegacyOpeningPositionEvent = {
  id: string;
  eventType: 'opening_position';
  assetId: string;
  date: string;
  sequence: number;
  quantity: string;
  totalAmount?: string;
  priceSource: 'manual_total' | 'legacy_unknown';
  needsReconciliation: boolean;
  createdAt: string;
  updatedAt: string;
};

type WorkingLot = { sourceEventId: string; acquiredDate: string; quantity: bigint; costBasis?: bigint };
type WorkingPosition = { asset: LedgerAsset; quantity: bigint; lots: WorkingLot[]; realizedGain: bigint; realizedKnown: boolean };

function localDate(now = Date.now()): string {
  return localCalendarDate(now);
}

export function compareLedgerEvents(left: LedgerEvent, right: LedgerEvent): number {
  return String(left?.date ?? '').localeCompare(String(right?.date ?? '')) ||
    Number(left?.sequence ?? 0) - Number(right?.sequence ?? 0) ||
    String(left?.createdAt ?? '').localeCompare(String(right?.createdAt ?? '')) ||
    String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

export function nextSequence(events: LedgerEvent[], date: string): number {
  return Math.max(0, ...events.filter((event) => event.date === date).map((event) => event.sequence)) + 1;
}

export function ledgerHoldings(ledger: PortfolioLedger, asOfDate?: string): Holding[] {
  const replay = replayLedger(ledger, asOfDate);
  return replay.state.positions
    .filter((position) => position.quantity > 0)
    .map((position) => ({ id: position.asset.id, symbol: position.asset.symbol, type: position.asset.type, quantity: position.quantity }));
}

function money(value: unknown, positive = true): bigint | undefined {
  const parsed = parseFixed(value, MONEY_DIGITS, !positive);
  return parsed !== undefined && (positive ? parsed > 0n : true) ? parsed : undefined;
}

function positionState(position: WorkingPosition): LedgerPositionState {
  const knownLots = position.lots.every((lot) => lot.costBasis !== undefined);
  const costBasis = knownLots ? position.lots.reduce((total, lot) => total + (lot.costBasis ?? 0n), 0n) : undefined;
  const lots: LedgerLotState[] = position.lots.map((lot) => ({
    sourceEventId: lot.sourceEventId,
    acquiredDate: lot.acquiredDate,
    quantity: formatFixed(lot.quantity, QUANTITY_DIGITS),
    costBasis: lot.costBasis === undefined ? undefined : fixedToNumber(lot.costBasis, MONEY_DIGITS)
  }));
  return {
    asset: position.asset,
    quantity: fixedToNumber(position.quantity, QUANTITY_DIGITS),
    quantityDecimal: formatFixed(position.quantity, QUANTITY_DIGITS),
    remainingCostBasis: costBasis === undefined ? undefined : fixedToNumber(costBasis, MONEY_DIGITS),
    averageCost: costBasis === undefined || position.quantity === 0n ? undefined : safeNumber(Number(costBasis) / Number(position.quantity) * 10 ** (QUANTITY_DIGITS - MONEY_DIGITS)),
    realizedGain: position.realizedKnown ? fixedToNumber(position.realizedGain, MONEY_DIGITS) : undefined,
    lots
  };
}

function issue(issues: LedgerValidationIssue[], event: LedgerEvent | undefined, message: string) {
  issues.push({ eventId: event?.id, date: event?.date, message });
}

export function createLedgerCursor(ledgerValue: PortfolioLedger, today = localDate()) {
  const ledger = ledgerValue?.schemaVersion === 2 ? ledgerValue : EMPTY_LEDGER;
  const issues: LedgerValidationIssue[] = [];
  const activities: AccountActivity[] = [];
  const assetIds = new Set<string>();
  const positions = new Map<string, WorkingPosition>();
  for (const asset of ledger.assets) {
    const symbol = asset.symbol?.trim().toUpperCase();
    if (!asset.id || assetIds.has(asset.id) || !symbol || !['stock', 'crypto'].includes(asset.type)) {
      issue(issues, undefined, `Invalid or duplicate asset ${asset.id || '(missing id)'}`);
      continue;
    }
    assetIds.add(asset.id);
    positions.set(asset.id, { asset: { ...asset, symbol }, quantity: 0n, lots: [], realizedGain: 0n, realizedKnown: true });
  }

  let cash = 0n;
  let debt = 0n;
  function recordActivity(event: LedgerEvent, account: 'cash' | 'debt', reason: AccountActivityReason, before: bigint, after: bigint, sourceView: 'asset' | 'cash' | 'debt', assetId?: string) {
    if (before === after) return;
    activities.push({
      id: `${event.id}:${account}`,
      account,
      reason,
      sourceEventId: event.id,
      sourceEventType: event.eventType,
      sourceView,
      assetId,
      date: event.date,
      sequence: event.sequence,
      delta: fixedToNumber(after - before, MONEY_DIGITS),
      balanceBefore: fixedToNumber(before, MONEY_DIGITS),
      balanceAfter: fixedToNumber(after, MONEY_DIGITS)
    });
  }
  const eventIds = new Set<string>();
  function apply(event: LedgerEvent) {
    if (!event.id || eventIds.has(event.id)) { issue(issues, event, 'Duplicate or missing transaction ID'); return; }
    eventIds.add(event.id);
    if (!isIsoDate(event.date) || event.date > today || !Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      issue(issues, event, 'Transaction has an invalid date or sequence');
      return;
    }

    if (event.eventType === 'buy' || event.eventType === 'sell') {
      const position = positions.get(event.assetId);
      const quantity = parseFixed(event.quantity, QUANTITY_DIGITS);
      if (!position) { issue(issues, event, 'Transaction references an unknown asset'); return; }
      if (quantity === undefined || quantity <= 0n) { issue(issues, event, 'Quantity must be greater than zero'); return; }

      const unknownExternalBuy = event.eventType === 'buy' && event.affectsCashDebt === false && event.priceSource === 'legacy_unknown' && event.totalAmount === undefined && event.unitPrice === undefined;
      if (unknownExternalBuy) {
        position.quantity += quantity;
        position.lots.push({ sourceEventId: event.id, acquiredDate: event.date, quantity, costBasis: undefined });
        return;
      }

      const amount = money(event.totalAmount, event.eventType === 'buy');
      const fees = parseFixed(event.fees, MONEY_DIGITS);
      const unitPrice = parseFixed(event.unitPrice, 6);
      if (amount === undefined || amount < 0n || fees === undefined || fees < 0n || unitPrice === undefined || unitPrice < 0n || (event.eventType === 'buy' && unitPrice === 0n)) {
        issue(issues, event, 'Transaction amount, price, or fees are invalid');
        return;
      }

      if (event.eventType === 'buy') {
        position.quantity += quantity;
        position.lots.push({ sourceEventId: event.id, acquiredDate: event.date, quantity, costBasis: amount });
        if (!event.affectsCashDebt) return;
        const cashBefore = cash;
        const debtBefore = debt;
        const fromCash = cash < amount ? cash : amount;
        cash -= fromCash;
        debt += amount - fromCash;
        recordActivity(event, 'cash', 'buy_funding', cashBefore, cash, 'asset', event.assetId);
        recordActivity(event, 'debt', 'buy_funding', debtBefore, debt, 'asset', event.assetId);
        return;
      }

      if (quantity > position.quantity) {
        issue(issues, event, `${position.asset.symbol}: sell exceeds ${formatFixed(position.quantity, QUANTITY_DIGITS)} units owned on ${event.date}`);
        return;
      }
      let remaining = quantity;
      let removedBasis = 0n;
      let basisKnown = true;
      for (const lot of position.lots) {
        if (remaining === 0n) break;
        if (lot.quantity === 0n) continue;
        const consumed = remaining < lot.quantity ? remaining : lot.quantity;
        if (lot.costBasis === undefined) basisKnown = false;
        else {
          const removed = consumed === lot.quantity ? lot.costBasis : divideRounded(lot.costBasis * consumed, lot.quantity);
          removedBasis += removed;
          lot.costBasis -= removed;
        }
        lot.quantity -= consumed;
        remaining -= consumed;
      }
      position.lots = position.lots.filter((lot) => lot.quantity > 0n);
      position.quantity -= quantity;
      if (basisKnown) position.realizedGain += amount - removedBasis;
      else position.realizedKnown = false;
      if (!event.affectsCashDebt) return;
      const cashBefore = cash;
      const debtBefore = debt;
      const debtPayment = debt < amount ? debt : amount;
      debt -= debtPayment;
      cash += amount - debtPayment;
      recordActivity(event, 'debt', 'sale_proceeds', debtBefore, debt, 'asset', event.assetId);
      recordActivity(event, 'cash', 'sale_proceeds', cashBefore, cash, 'asset', event.assetId);
      return;
    }

    const adjustment = event.eventType === 'cash_adjustment' || event.eventType === 'debt_adjustment';
    const amount = money(event.amount, !adjustment);
    if (amount === undefined || (adjustment ? amount === 0n : amount <= 0n)) {
      issue(issues, event, 'Cash or debt amount is invalid');
      return;
    }
    if (event.eventType === 'cash_opening') {
      const before = cash;
      cash = amount;
      recordActivity(event, 'cash', 'opening', before, cash, 'cash');
    }
    else if (event.eventType === 'debt_opening') {
      const before = debt;
      debt = amount;
      recordActivity(event, 'debt', 'opening', before, debt, 'debt');
    }
    else if (event.eventType === 'cash_deposit') {
      const cashBefore = cash;
      const debtBefore = debt;
      const payment = debt < amount ? debt : amount;
      debt -= payment;
      cash += amount - payment;
      recordActivity(event, 'debt', 'deposit_allocation', debtBefore, debt, 'cash');
      recordActivity(event, 'cash', 'deposit_allocation', cashBefore, cash, 'cash');
    } else if (event.eventType === 'cash_withdrawal') {
      const cashBefore = cash;
      const debtBefore = debt;
      const fromCash = cash < amount ? cash : amount;
      cash -= fromCash;
      debt += amount - fromCash;
      recordActivity(event, 'cash', 'withdrawal_funding', cashBefore, cash, 'cash');
      recordActivity(event, 'debt', 'withdrawal_funding', debtBefore, debt, 'cash');
    } else if (event.eventType === 'cash_adjustment') {
      if (cash + amount < 0n) { issue(issues, event, 'Cash adjustment would make Cash negative'); return; }
      const before = cash;
      cash += amount;
      recordActivity(event, 'cash', 'manual_adjustment', before, cash, 'cash');
    } else if (event.eventType === 'debt_adjustment') {
      if (debt + amount < 0n) { issue(issues, event, 'Debt adjustment would make Debt negative'); return; }
      const before = debt;
      debt += amount;
      recordActivity(event, 'debt', 'manual_adjustment', before, debt, 'debt');
    } else if (event.eventType === 'debt_payment') {
      if (amount > debt) { issue(issues, event, 'Debt payment exceeds the current Debt balance'); return; }
      if (event.source !== 'external' && event.source !== 'cash') { issue(issues, event, 'Debt payment source is invalid'); return; }
      if (event.source === 'cash' && amount > cash) { issue(issues, event, 'Debt payment exceeds available Cash'); return; }
      const cashBefore = cash;
      const debtBefore = debt;
      if (event.source === 'cash') cash -= amount;
      debt -= amount;
      recordActivity(event, 'cash', 'debt_payment', cashBefore, cash, 'debt');
      recordActivity(event, 'debt', 'debt_payment', debtBefore, debt, 'debt');
    }
  }

  function snapshot(asOfDate?: string, compact = false): LedgerReplayResult { return {
    state: {
      asOfDate,
      cash: fixedToNumber(cash, MONEY_DIGITS),
      debt: fixedToNumber(debt, MONEY_DIGITS),
      positions: [...positions.values()].map(p => compact ? { asset: p.asset, quantity: fixedToNumber(p.quantity, QUANTITY_DIGITS), quantityDecimal: formatFixed(p.quantity, QUANTITY_DIGITS), lots: [] } : positionState(p))
    },
    issues,
    activities
  };
  }
  return { apply, snapshot };
}

export function replayLedger(ledger: PortfolioLedger, asOfDate?: string, today = localDate()): LedgerReplayResult {
  const cursor = createLedgerCursor(ledger, today);
  for (const event of [...ledger.events].sort(compareLedgerEvents)) if (!asOfDate || event.date <= asOfDate) cursor.apply(event);
  return cursor.snapshot(asOfDate);
}

export function updateLedgerEvent(ledger: PortfolioLedger, event: LedgerEvent, today?: string): { ledger?: PortfolioLedger; issues: LedgerValidationIssue[] } {
  const exists = ledger.events.some((candidate) => candidate.id === event.id);
  const next = { ...ledger, events: exists ? ledger.events.map((candidate) => candidate.id === event.id ? event : candidate) : [...ledger.events, event] };
  try {
    const result = replayLedger(next, undefined, today);
    return result.issues.length ? { issues: result.issues } : { ledger: next, issues: [] };
  } catch (error) { return { issues: [{ eventId: event.id, date: event.date, message: String(error) }] }; }
}

export function isNegativeAccountAdjustment(event: LedgerEvent): boolean {
  if (event.eventType !== 'cash_adjustment' && event.eventType !== 'debt_adjustment') return false;
  const amount = parseFixed(event.amount, MONEY_DIGITS, true);
  return amount !== undefined && amount < 0n;
}

export function updateLedgerEventRemovingAdjustments(
  ledger: PortfolioLedger,
  event: LedgerEvent,
  adjustmentIds: string[],
  today?: string
): { ledger?: PortfolioLedger; issues: LedgerValidationIssue[] } {
  const ids = new Set(adjustmentIds.filter((id) => id !== event.id));
  if (!ids.size) return { issues: [{ eventId: event.id, date: event.date, message: 'No redundant account adjustments were selected' }] };
  const blockedUpdate = updateLedgerEvent(ledger, event, today);
  if (blockedUpdate.ledger) return { issues: [{ eventId: event.id, date: event.date, message: 'The trade can be saved without removing an account adjustment' }] };
  const blockingIds = new Set(blockedUpdate.issues.flatMap((issue) => issue.eventId && issue.eventId !== event.id ? [issue.eventId] : []));
  for (const id of ids) {
    const candidate = ledger.events.find((item) => item.id === id);
    if (!candidate || !blockingIds.has(id) || !isNegativeAccountAdjustment(candidate)) {
      return { issues: [{ eventId: candidate?.id ?? id, date: candidate?.date, message: 'Only listed blocking negative Cash or Debt adjustments can be removed with a trade edit' }] };
    }
  }
  const withoutAdjustments = { ...ledger, events: ledger.events.filter((candidate) => !ids.has(candidate.id)) };
  return updateLedgerEvent(withoutAdjustments, event, today);
}

export function previewLedgerEvent(ledger: PortfolioLedger, event: LedgerEvent, today?: string): LedgerEventPreviewResult {
  const before = replayLedger(ledger, undefined, today);
  if (before.issues.length) return { issues: before.issues };
  const updated = updateLedgerEvent(ledger, event, today);
  if (!updated.ledger) return { issues: updated.issues };
  const after = replayLedger(updated.ledger, undefined, today);
  const assetId = 'assetId' in event ? event.assetId : undefined;
  const beforeQuantity = assetId ? before.state.positions.find((position) => position.asset.id === assetId)?.quantity ?? 0 : 0;
  const afterQuantity = assetId ? after.state.positions.find((position) => position.asset.id === assetId)?.quantity ?? 0 : 0;
  return {
    preview: {
      cashDelta: Number((after.state.cash - before.state.cash).toFixed(MONEY_DIGITS)),
      debtDelta: Number((after.state.debt - before.state.debt).toFixed(MONEY_DIGITS)),
      positionDelta: Number((afterQuantity - beforeQuantity).toFixed(QUANTITY_DIGITS)),
      resultingCash: after.state.cash,
      resultingDebt: after.state.debt
    },
    issues: []
  };
}

export function deleteLedgerEvent(ledger: PortfolioLedger, eventId: string, today?: string): { ledger?: PortfolioLedger; issues: LedgerValidationIssue[] } {
  const next = { ...ledger, events: ledger.events.filter((event) => event.id !== eventId) };
  const result = replayLedger(next, undefined, today);
  return result.issues.length ? { issues: result.issues } : { ledger: next, issues: [] };
}

export function migrateLegacyHoldings(holdings: Holding[], historyStartDate: string, now = new Date().toISOString()): PortfolioLedger {
  const assets: LedgerAsset[] = [];
  const events: LedgerEvent[] = [];
  let sequence = 1;
  for (const holding of holdings) {
    const quantity = parseFixed(typeof holding?.quantity === 'number' && Number.isFinite(holding.quantity) ? holding.quantity.toFixed(QUANTITY_DIGITS) : holding?.quantity, QUANTITY_DIGITS);
    const symbol = holding.symbol?.trim().toUpperCase();
    if (!holding.id || !symbol || quantity === undefined || quantity <= 0n || !['stock', 'crypto'].includes(holding.type)) throw new Error('INTEGRITY_ERROR: Invalid legacy holding. Migration stopped.');
    assets.push({ id: holding.id, symbol, type: holding.type, createdAt: now });
    events.push({
      id: `legacy-${holding.id}`,
      eventType: 'buy',
      assetId: holding.id,
      date: historyStartDate,
      sequence: sequence++,
      quantity: formatFixed(quantity, QUANTITY_DIGITS),
      fees: '0',
      priceSource: 'legacy_unknown',
      affectsCashDebt: false,
      createdAt: now,
      updatedAt: now
    });
  }
  return { schemaVersion: 2, assets, events };
}

export function emptyLedger(): PortfolioLedger { return structuredClone(EMPTY_LEDGER); }

export function sanitizeLedger(value: unknown): PortfolioLedger | undefined {
  if (value == null) return undefined;
  const invalid = () => { throw new Error('INTEGRITY_ERROR: Saved financial history is invalid. No records were discarded.'); };
  if (typeof value !== 'object') return invalid();
  const candidate = value as { schemaVersion?: number; assets?: unknown[]; events?: unknown[] };
  if ((candidate.schemaVersion ?? 0) > 2) throw new Error('UNSUPPORTED_SCHEMA: Update Finance Widget to open this newer portfolio.');
  if (![1, 2].includes(candidate.schemaVersion ?? 0) || !Array.isArray(candidate.assets) || !Array.isArray(candidate.events)) return invalid();
  const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const assets = candidate.assets as LedgerAsset[];
  for (const a of assets) if (!a || typeof a !== 'object' || !nonempty(a.id) || !nonempty(a.symbol) || !nonempty(a.createdAt) || !['stock','crypto'].includes(a.type)) return invalid();
  for (const raw of candidate.events) {
    if (!raw || typeof raw !== 'object') return invalid();
    const e = raw as Record<string, unknown>;
    if (!nonempty(e.id) || !nonempty(e.createdAt) || !nonempty(e.updatedAt) || !isIsoDate(e.date) || !Number.isSafeInteger(e.sequence) || Number(e.sequence) < 1) return invalid();
    if (!['buy','sell','opening_position','cash_opening','cash_deposit','cash_withdrawal','cash_adjustment','debt_opening','debt_adjustment','debt_payment'].includes(String(e.eventType))) return invalid();
    if (['buy','sell','opening_position'].includes(String(e.eventType))) {
      if (!nonempty(e.assetId) || typeof e.quantity !== 'string') return invalid();
      if (e.eventType !== 'opening_position') {
        if (candidate.schemaVersion === 2 && typeof e.affectsCashDebt !== 'boolean') return invalid();
        if (typeof e.fees !== 'string' || !['manual_unit','manual_total','historical_close','previous_trading_close','current_quote','stale_quote_confirmed','legacy_unknown'].includes(String(e.priceSource))) return invalid();
        for (const field of ['unitPrice','totalAmount']) if (e[field] !== undefined && typeof e[field] !== 'string') return invalid();
      } else if (candidate.schemaVersion !== 1 || typeof e.needsReconciliation !== 'boolean' || !['manual_total','legacy_unknown'].includes(String(e.priceSource)) || (e.totalAmount !== undefined && (typeof e.totalAmount !== 'string' || (parseFixed(e.totalAmount, MONEY_DIGITS) ?? 0n) <= 0n))) return invalid();
    } else if (typeof e.amount !== 'string') return invalid();
  }
  const events = (candidate.events as (LedgerEvent | LegacyOpeningPositionEvent)[]).flatMap((event) => {
    if (event.eventType === 'opening_position') {
      const quantity = parseFixed(event.quantity, QUANTITY_DIGITS);
      const total = event.totalAmount === undefined ? undefined : parseFixed(event.totalAmount, MONEY_DIGITS);
      if (quantity === undefined || quantity <= 0n) return invalid();
      const knownBasis = total !== undefined && total > 0n;
      const unitPrice = knownBasis
        ? formatFixed(divideRounded(total * 10n ** BigInt(QUANTITY_DIGITS + PRICE_DIGITS - MONEY_DIGITS), quantity), PRICE_DIGITS)
        : undefined;
      return [{
        id: event.id,
        eventType: 'buy' as const,
        assetId: event.assetId,
        date: event.date,
        sequence: event.sequence,
        quantity: formatFixed(quantity, QUANTITY_DIGITS),
        unitPrice,
        fees: '0',
        totalAmount: knownBasis ? formatFixed(total, MONEY_DIGITS) : undefined,
        priceSource: knownBasis ? 'manual_total' as const : 'legacy_unknown' as const,
        affectsCashDebt: false,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
      }];
    }
    if (event.eventType === 'buy' || event.eventType === 'sell') {
      return [{ ...event, affectsCashDebt: typeof event.affectsCashDebt === 'boolean' ? event.affectsCashDebt : true } as LedgerEvent];
    }
    return [event as LedgerEvent];
  });
  const ledger: PortfolioLedger = { schemaVersion: 2, assets, events };
  if (replayLedger(ledger).issues.length) return invalid();
  return ledger;
}

/** New targets follow all existing events on their date; edits keep their sequence. */
export function datedBalanceDelta(ledger: PortfolioLedger, kind: 'cash' | 'debt', target: string, date: string, editing?: LedgerEvent): string | undefined {
  const amount = parseFixed(target, MONEY_DIGITS);
  if (amount === undefined || !isIsoDate(date)) return undefined;
  const marker = { id: editing?.id ?? '__preview__', date, sequence: editing?.date === date ? editing.sequence : nextSequence(ledger.events, date), createdAt: editing?.createdAt ?? 'preview' } as LedgerEvent;
  const prior = { ...ledger, events: ledger.events.filter(e => e.id !== editing?.id && compareLedgerEvents(e, marker) < 0) };
  const replay = replayLedger(prior);
  if (replay.issues.length) return undefined;
  const base = parseFixed(replay.state[kind].toFixed(MONEY_DIGITS), MONEY_DIGITS);
  if (base === undefined || amount === base) return undefined;
  return formatFixed(amount - base, MONEY_DIGITS);
}
