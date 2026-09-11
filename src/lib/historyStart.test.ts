import { describe, expect, it } from 'vitest';
import { earliestBuyDate, resolveHistoryStart } from './historyStart';
import { emptyLedger, migrateLegacyHoldings, sanitizeLedger } from './ledger';

const config = { historyStartMode: 'auto' as const, historyStartDate: '2020-01-01' };
describe('shared history start', () => {
  it('keeps the configured fallback with no buys', () => {
    expect(earliestBuyDate(emptyLedger())).toBeUndefined();
    expect(resolveHistoryStart(config, emptyLedger())).toBe(config.historyStartDate);
  });
  it('uses one buy and follows the earliest existing buy after edits', () => {
    const ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'stock', quantity: 1 }], '2020-01-03');
    expect(resolveHistoryStart(config, ledger)).toBe('2020-01-03');
    ledger.events.push({ ...ledger.events[0], id: 'second', date: '2020-01-02', sequence: 2 });
    expect(resolveHistoryStart(config, ledger)).toBe('2020-01-02');
    ledger.events[1].date = '2020-01-04';
    expect(resolveHistoryStart(config, ledger)).toBe('2020-01-03');
    expect(resolveHistoryStart({ ...config, historyStartMode: 'manual' }, ledger)).toBe('2020-01-01');
  });
  it('uses the normalized buy from a legacy opening position', () => {
    const ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'stock', quantity: 1 }], '2020-01-03');
    const old = { ...ledger, schemaVersion: 1, events: [{ ...ledger.events[0], eventType: 'opening_position', needsReconciliation: true }] };
    const migrated = sanitizeLedger(old)!;
    expect(migrated.events[0].eventType).toBe('buy');
    expect(earliestBuyDate(migrated)).toBe('2020-01-03');
  });
});
