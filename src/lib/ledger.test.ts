import { describe, expect, it } from 'vitest';
import { deleteLedgerEvent, migrateLegacyHoldings, previewLedgerEvent, replayLedger, sanitizeLedger, updateLedgerEvent } from './ledger';
import type { LedgerAsset, LedgerEvent, PortfolioLedger } from './types';

const createdAt = '2026-08-17T00:00:00.000Z';
const asset: LedgerAsset = { id: 'stock', symbol: 'AAA', type: 'stock', createdAt };

type EventInput<T> = T extends LedgerEvent ? Omit<T, 'id' | 'sequence' | 'createdAt' | 'updatedAt'> : never;
type LedgerEventInput = EventInput<LedgerEvent>;

function event(value: LedgerEventInput, index: number): LedgerEvent {
  return { ...value, id: `event-${index}`, sequence: index, createdAt, updatedAt: createdAt } as LedgerEvent;
}

function ledger(...events: LedgerEvent[]): PortfolioLedger {
  return { schemaVersion: 2, assets: [asset], events };
}

const openingCash = (amount: string, index = 1) => event({ eventType: 'cash_opening', date: '2026-08-17', amount }, index);
const openingDebt = (amount: string, index = 1) => event({ eventType: 'debt_opening', date: '2026-08-17', amount }, index);
const buy = (quantity: string, totalAmount: string, index: number, date = '2026-08-18', fees = '0', affectsCashDebt = true) => event({
  eventType: 'buy', assetId: asset.id, date, quantity, unitPrice: '100', fees, totalAmount, priceSource: 'manual_total', affectsCashDebt
}, index);
const sell = (quantity: string, totalAmount: string, index: number, date = '2026-08-25', fees = '0', affectsCashDebt = true) => event({
  eventType: 'sell', assetId: asset.id, date, quantity, unitPrice: '150', fees, totalAmount, priceSource: 'manual_total', affectsCashDebt
}, index);
const unknownExternalBuy = (quantity: string, index: number, date = '2026-08-17') => event({
  eventType: 'buy', assetId: asset.id, date, quantity, fees: '0', priceSource: 'legacy_unknown', affectsCashDebt: false
}, index);

describe('ledger cash and debt accounting', () => {
  it('funds a buy fully from cash', () => {
    const result = replayLedger(ledger(openingCash('10000'), buy('60', '6000', 2)), undefined, '2026-08-29');
    expect(result.issues).toEqual([]);
    expect(result.state.cash).toBe(4000);
    expect(result.state.debt).toBe(0);
  });

  it('funds a buy partially from debt', () => {
    const state = replayLedger(ledger(openingCash('2000'), buy('60', '6000', 2)), undefined, '2026-08-29').state;
    expect(state.cash).toBe(0);
    expect(state.debt).toBe(4000);
  });

  it('funds a buy entirely from debt', () => {
    const state = replayLedger(ledger(buy('50', '5000', 1)), undefined, '2026-08-29').state;
    expect(state.cash).toBe(0);
    expect(state.debt).toBe(5000);
  });

  it('adds a known-basis external Buy without changing Cash or Debt', () => {
    const external = buy('2.5', '100', 1, '2026-08-17', '0', false);
    const state = replayLedger(ledger(external), undefined, '2026-08-29').state;
    expect(state).toMatchObject({ cash: 0, debt: 0 });
    expect(state.positions[0]).toMatchObject({ quantity: 2.5, remainingCostBasis: 100 });
    expect(state.positions[0].averageCost).toBeCloseTo(40, 2);
  });

  it('can change a funded Buy to external without changing its position or basis', () => {
    const purchase = buy('2.5', '100', 1, '2026-08-17');
    expect(replayLedger(ledger(purchase), undefined, '2026-08-29').state.debt).toBe(100);
    const external = { ...purchase, affectsCashDebt: false };
    const updated = updateLedgerEvent(ledger(purchase), external, '2026-08-29');
    expect(updated.issues).toEqual([]);
    expect(replayLedger(updated.ledger!, undefined, '2026-08-29').state).toMatchObject({ cash: 0, debt: 0 });
    expect(replayLedger(updated.ledger!, undefined, '2026-08-29').state.positions[0].quantity).toBe(2.5);
  });

  it('uses sale proceeds to pay debt before increasing cash', () => {
    const position = unknownExternalBuy('60', 1);
    const state = replayLedger(ledger(position, openingDebt('4000', 2), openingCash('500', 3), sell('40', '6000', 4)), undefined, '2026-08-29').state;
    expect(state.debt).toBe(0);
    expect(state.cash).toBe(2500);
  });

  it('uses deposits to pay debt before increasing cash', () => {
    const deposit = event({ eventType: 'cash_deposit', date: '2026-08-18', amount: '5000' }, 2);
    const state = replayLedger(ledger(openingDebt('4000'), deposit), undefined, '2026-08-29').state;
    expect(state.debt).toBe(0);
    expect(state.cash).toBe(1000);
  });

  it('keeps cash unchanged when a deposit is smaller than debt', () => {
    const deposit = event({ eventType: 'cash_deposit', date: '2026-08-18', amount: '1500' }, 2);
    const state = replayLedger(ledger(openingDebt('4000'), deposit), undefined, '2026-08-29').state;
    expect(state.debt).toBe(2500);
    expect(state.cash).toBe(0);
  });

  it('turns a withdrawal beyond cash into debt', () => {
    const withdrawal = event({ eventType: 'cash_withdrawal', date: '2026-08-18', amount: '2500' }, 2);
    const state = replayLedger(ledger(openingCash('1000'), withdrawal), undefined, '2026-08-29').state;
    expect(state.cash).toBe(0);
    expect(state.debt).toBe(1500);
  });

  it('prevents debt adjustments below zero', () => {
    const adjustment = event({ eventType: 'debt_adjustment', date: '2026-08-18', amount: '-1001' }, 2);
    const result = replayLedger(ledger(openingDebt('1000'), adjustment), undefined, '2026-08-29');
    expect(result.issues[0].message).toContain('negative');
    expect(result.state.debt).toBe(1000);
  });

  it('records external and Cash-funded Debt payments distinctly', () => {
    const external = event({ eventType: 'debt_payment', date: '2026-08-18', amount: '400', source: 'external' }, 3);
    const fromCash = event({ eventType: 'debt_payment', date: '2026-08-19', amount: '300', source: 'cash' }, 4);
    const result = replayLedger(ledger(openingDebt('1000'), openingCash('500', 2), external, fromCash), undefined, '2026-08-29');
    expect(result.issues).toEqual([]);
    expect(result.state).toMatchObject({ cash: 200, debt: 300 });
    expect(result.activities.filter((item) => item.reason === 'debt_payment')).toEqual([
      expect.objectContaining({ account: 'debt', delta: -400, sourceView: 'debt' }),
      expect.objectContaining({ account: 'cash', delta: -300, sourceView: 'debt' }),
      expect.objectContaining({ account: 'debt', delta: -300, sourceView: 'debt' })
    ]);
  });

  it('rejects Debt payments beyond Debt or available Cash', () => {
    const tooMuchDebt = event({ eventType: 'debt_payment', date: '2026-08-18', amount: '1001', source: 'external' }, 3);
    expect(replayLedger(ledger(openingDebt('1000'), openingCash('100', 2), tooMuchDebt), undefined, '2026-08-29').issues[0].message).toContain('exceeds');
    const tooMuchCash = event({ eventType: 'debt_payment', date: '2026-08-18', amount: '200', source: 'cash' }, 3);
    expect(replayLedger(ledger(openingDebt('1000'), openingCash('100', 2), tooMuchCash), undefined, '2026-08-29').issues[0].message).toContain('Cash');
  });

  it('derives source-linked account activity with running balances', () => {
    const deposit = event({ eventType: 'cash_deposit', date: '2026-08-19', amount: '5000' }, 3);
    const result = replayLedger(ledger(openingCash('2000'), buy('60', '6000', 2), deposit), undefined, '2026-08-29');
    expect(result.activities).toEqual([
      expect.objectContaining({ account: 'cash', reason: 'opening', delta: 2000, balanceBefore: 0, balanceAfter: 2000, sourceView: 'cash' }),
      expect.objectContaining({ account: 'cash', reason: 'buy_funding', delta: -2000, balanceAfter: 0, sourceView: 'asset', assetId: 'stock' }),
      expect.objectContaining({ account: 'debt', reason: 'buy_funding', delta: 4000, balanceAfter: 4000, sourceView: 'asset', assetId: 'stock' }),
      expect.objectContaining({ account: 'debt', reason: 'deposit_allocation', delta: -4000, balanceAfter: 0, sourceView: 'cash' }),
      expect.objectContaining({ account: 'cash', reason: 'deposit_allocation', delta: 1000, balanceAfter: 1000, sourceView: 'cash' })
    ]);
  });

  it('supports non-destructive Cash and Debt balance adjustments', () => {
    const cashSet = event({ eventType: 'cash_adjustment', date: '2026-08-18', amount: '-250' }, 3);
    const debtSet = event({ eventType: 'debt_adjustment', date: '2026-08-18', amount: '-600' }, 4);
    const result = replayLedger(ledger(openingCash('500'), openingDebt('1000', 2), cashSet, debtSet), undefined, '2026-08-29');
    expect(result.issues).toEqual([]);
    expect(result.state).toMatchObject({ cash: 250, debt: 400 });
    expect(result.activities.slice(-2)).toEqual([
      expect.objectContaining({ account: 'cash', reason: 'manual_adjustment', balanceAfter: 250 }),
      expect.objectContaining({ account: 'debt', reason: 'manual_adjustment', balanceAfter: 400 })
    ]);
  });
});

describe('per-trade Cash and Debt impact', () => {
  it('keeps external Buy funding independent from a funded Buy', () => {
    const external = buy('1', '5000', 1, '2026-08-17', '0', false);
    const funded = buy('1', '6000', 2, '2026-08-18');
    const result = replayLedger(ledger(external, funded), undefined, '2026-08-29');
    expect(result.state.positions[0]).toMatchObject({ quantity: 2, remainingCostBasis: 11000 });
    expect(result.state).toMatchObject({ cash: 0, debt: 6000 });
    expect(result.activities.filter((item) => item.reason === 'buy_funding')).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({ sourceEventId: funded.id, account: 'debt' });
  });

  it('calculates FIFO gain for an external Sell without changing Cash or Debt', () => {
    const position = buy('10', '1000', 1, '2026-08-17', '0', false);
    const externalSale = sell('4', '600', 2, '2026-08-20', '0', false);
    const result = replayLedger(ledger(position, openingDebt('200', 3), externalSale), undefined, '2026-08-29');
    expect(result.state).toMatchObject({ cash: 0, debt: 200 });
    expect(result.state.positions[0]).toMatchObject({ quantity: 6, remainingCostBasis: 600, realizedGain: 200 });
    expect(result.activities.some((item) => item.sourceEventId === externalSale.id)).toBe(false);
  });
});

describe('ledger consequence previews', () => {
  it('previews fully Cash-funded, partially Debt-funded, and fully Debt-funded buys', () => {
    expect(previewLedgerEvent(ledger(openingCash('10000')), buy('60', '6000', 2), '2026-08-29').preview).toMatchObject({ cashDelta: -6000, debtDelta: 0, resultingCash: 4000 });
    expect(previewLedgerEvent(ledger(openingCash('2000')), buy('60', '6000', 2), '2026-08-29').preview).toMatchObject({ cashDelta: -2000, debtDelta: 4000, resultingDebt: 4000 });
    expect(previewLedgerEvent(ledger(), buy('50', '5000', 1), '2026-08-29').preview).toMatchObject({ cashDelta: 0, debtDelta: 5000, resultingDebt: 5000 });
  });

  it('previews external Buy and Sell position changes with zero account deltas', () => {
    const externalBuy = buy('10', '1000', 1, '2026-08-17', '0', false);
    expect(previewLedgerEvent(ledger(), externalBuy, '2026-08-29').preview).toMatchObject({ cashDelta: 0, debtDelta: 0, positionDelta: 10 });
    const externalSell = sell('4', '600', 2, '2026-08-20', '0', false);
    expect(previewLedgerEvent(ledger(externalBuy), externalSell, '2026-08-29').preview).toMatchObject({ cashDelta: 0, debtDelta: 0, positionDelta: -4 });
  });

  it('previews a Debt-funded buy after a migrated unknown-basis opening position', () => {
    const opening = unknownExternalBuy('2.5', 1);
    expect(previewLedgerEvent(ledger(opening), { ...buy('0.1', '100', 1, '2026-08-29'), id: 'preview' }, '2026-08-29').preview).toMatchObject({ cashDelta: 0, debtDelta: 100, positionDelta: 0.1 });
  });

  it('previews sale proceeds paying Debt before Cash', () => {
    const position = unknownExternalBuy('60', 1);
    const result = previewLedgerEvent(ledger(position, openingDebt('4000', 2), openingCash('500', 3)), sell('40', '6000', 4), '2026-08-29');
    expect(result.preview).toMatchObject({ debtDelta: -4000, cashDelta: 2000, resultingDebt: 0, resultingCash: 2500 });
  });

  it('previews deposits paying Debt and withdrawals creating Debt', () => {
    const deposit = event({ eventType: 'cash_deposit', date: '2026-08-18', amount: '5000' }, 2);
    expect(previewLedgerEvent(ledger(openingDebt('4000')), deposit, '2026-08-29').preview).toMatchObject({ debtDelta: -4000, cashDelta: 1000 });
    const withdrawal = event({ eventType: 'cash_withdrawal', date: '2026-08-18', amount: '2500' }, 2);
    expect(previewLedgerEvent(ledger(openingCash('1000')), withdrawal, '2026-08-29').preview).toMatchObject({ cashDelta: -1000, debtDelta: 1500 });
  });
});

describe('FIFO cost basis', () => {
  it('supports a partial sell from one lot including buy and sell fees', () => {
    const result = replayLedger(ledger(openingCash('10000'), buy('10', '1002', 2, '2026-08-18', '2'), sell('4', '599', 3, '2026-08-20', '1')), undefined, '2026-08-29');
    const position = result.state.positions[0];
    expect(position.quantity).toBe(6);
    expect(position.remainingCostBasis).toBe(601.2);
    expect(position.realizedGain).toBe(198.2);
    expect(position.averageCost).toBe(100.2);
  });

  it('consumes multiple lots and leaves the newest remainder', () => {
    const result = replayLedger(ledger(buy('10', '1000', 1), buy('10', '1200', 2, '2026-08-19'), sell('15', '2250', 3)), undefined, '2026-08-29');
    const position = result.state.positions[0];
    expect(position.quantity).toBe(5);
    expect(position.remainingCostBasis).toBe(600);
    expect(position.realizedGain).toBe(650);
    expect(position.lots).toHaveLength(1);
  });

  it('depletes exact and fractional lots deterministically', () => {
    const result = replayLedger(ledger(buy('0.125', '25', 1), sell('0.125', '30', 2)), undefined, '2026-08-29');
    expect(result.state.positions[0].quantity).toBe(0);
    expect(result.state.positions[0].remainingCostBasis).toBe(0);
    expect(result.state.positions[0].realizedGain).toBe(5);
  });

  it('rejects a sell exceeding holdings on its historical date', () => {
    const result = replayLedger(ledger(buy('20', '2000', 1, '2026-08-18'), sell('21', '3150', 2, '2026-08-20'), buy('30', '3000', 3, '2026-08-22')), undefined, '2026-08-29');
    expect(result.issues[0].message).toContain('20 units owned');
  });

  it('rejects editing an old buy when it invalidates a later sell', () => {
    const original = ledger(buy('20', '2000', 1), sell('15', '2250', 2));
    const changed = { ...original.events[0], quantity: '10' } as LedgerEvent;
    const result = updateLedgerEvent(original, changed, '2026-08-29');
    expect(result.ledger).toBeUndefined();
    expect(result.issues[0].message).toContain('sell exceeds');
  });

  it('rejects deleting a buy when it invalidates a later sell', () => {
    const original = ledger(buy('20', '2000', 1), sell('15', '2250', 2));
    const result = deleteLedgerEvent(original, original.events[0].id, '2026-08-29');
    expect(result.ledger).toBeUndefined();
  });
});

describe('legacy migration', () => {
  it('creates a truly empty ledger for a fresh profile without legacy holdings', () => {
    expect(migrateLegacyHoldings([], '2026-08-17', createdAt)).toEqual({ schemaVersion: 2, assets: [], events: [] });
  });

  it('creates unknown-basis external Buys without cash or debt', () => {
    const migrated = migrateLegacyHoldings([{ id: 'test', symbol: 'TEST', type: 'stock', quantity: 7 }], '2026-08-17', createdAt);
    const result = replayLedger(migrated, undefined, '2026-08-29');
    expect(result.state.positions[0].quantity).toBe(7);
    expect(result.state.positions[0].remainingCostBasis).toBeUndefined();
    expect(result.state.cash).toBe(0);
    expect(result.state.debt).toBe(0);
    expect(migrated.events[0]).toMatchObject({ eventType: 'buy', priceSource: 'legacy_unknown', affectsCashDebt: false });
  });

  it('migrates schema-1 trades and Opening Positions without changing their account meaning', () => {
    const legacy = {
      schemaVersion: 1,
      assets: [asset],
      events: [
        { ...buy('1', '100', 1), affectsCashDebt: undefined },
        { id: 'known', eventType: 'opening_position', assetId: asset.id, date: '2026-08-18', sequence: 2, quantity: '2', totalAmount: '240', priceSource: 'manual_total', needsReconciliation: false, createdAt, updatedAt: createdAt },
        { id: 'unknown', eventType: 'opening_position', assetId: asset.id, date: '2026-08-19', sequence: 3, quantity: '3', priceSource: 'legacy_unknown', needsReconciliation: true, createdAt, updatedAt: createdAt }
      ]
    };
    const migrated = sanitizeLedger(legacy)!;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.events).toEqual([
      expect.objectContaining({ eventType: 'buy', affectsCashDebt: true }),
      expect.objectContaining({ id: 'known', eventType: 'buy', unitPrice: '120', totalAmount: '240', affectsCashDebt: false }),
      expect.objectContaining({ id: 'unknown', eventType: 'buy', unitPrice: undefined, totalAmount: undefined, priceSource: 'legacy_unknown', affectsCashDebt: false })
    ]);
    const state = replayLedger(migrated, undefined, '2026-08-29').state;
    expect(state).toMatchObject({ cash: 0, debt: 100 });
    expect(state.positions[0]).toMatchObject({ quantity: 6, remainingCostBasis: undefined });
  });

  it('handles malformed persisted event records without throwing', () => {
    const malformed = sanitizeLedger({ schemaVersion: 1, assets: [asset], events: [{ id: 'broken' }] })!;
    const result = replayLedger(malformed, undefined, '2026-08-29');
    expect(result.issues[0].message).toContain('invalid date');
  });
});
