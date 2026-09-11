import { expect, it } from 'vitest';
import { accountHoldings, migrateLegacyHoldings, previewLedgerEvent, replayLedger, updateLedgerEvent } from './ledger';
import type { BuyEvent } from './types';

it('reuses the proposed replay: two passes instead of three, with identical results', () => {
  const ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'stock', quantity: 1 }], '2020-01-01');
  let quantityReads = 0;
  ledger.events = Array.from({ length: 100 }, (_, index) => {
    const event = { ...ledger.events[0], id: `synthetic-${index}`, sequence: index + 1 };
    Object.defineProperty(event, 'quantity', { enumerable: true, get() { quantityReads++; return '1'; } });
    return event;
  });
  const draft = { ...ledger.events[0], id: 'draft', sequence: 101, quantity: '2' } as BuyEvent;
  quantityReads = 0;
  const before = replayLedger(ledger);
  const updated = updateLedgerEvent(ledger, draft);
  const after = replayLedger(updated.ledger!);
  const previousWork = quantityReads;
  quantityReads = 0;
  const actual = previewLedgerEvent(ledger, draft);
  expect(actual.issues).toEqual([]);
  expect(actual.preview).toEqual({ cashDelta: after.state.cash - before.state.cash, debtDelta: after.state.debt - before.state.debt, positionDelta: 2, resultingCash: after.state.cash, resultingDebt: after.state.debt });
  expect(quantityReads).toBe(200);
  expect(previousWork).toBe(300);
  expect(updated.replay).toEqual(after);
  quantityReads = 0;
  expect(accountHoldings(after.state)[0].quantity).toBe(102);
  expect(quantityReads).toBe(0);
});
