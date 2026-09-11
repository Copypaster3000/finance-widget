import { describe, expect, it, vi } from 'vitest';
import { calculateLedgerHistory, syncLedgerPriceCache } from './ledgerHistory';
import { migrateLegacyHoldings } from './ledger';
import { calendarDateFromTimestamp } from './calendar';
import type { LedgerEvent, LedgerPriceCache, PortfolioLedger, PriceProvider } from './types';

const createdAt = '2026-08-17T00:00:00.000Z';
type EventInput<T> = T extends LedgerEvent ? Omit<T, 'id' | 'sequence' | 'createdAt' | 'updatedAt'> : never;
function event(value: EventInput<LedgerEvent>, sequence: number): LedgerEvent {
  return { ...value, id: `event-${sequence}`, sequence, createdAt, updatedAt: createdAt } as LedgerEvent;
}

describe('ledger-aware portfolio history', () => {
  it('waits for both assets and carries a closed-market stock price through crypto updates', () => {
    const ledger = migrateLegacyHoldings([{ id: 'equity', symbol: 'SYNTH-A', type: 'stock', quantity: 2.5 }, { id: 'coin', symbol: 'SYNTH-B', type: 'crypto', quantity: 0.25 }], '2020-01-01');
    const cache: LedgerPriceCache = { schemaVersion: 1, entries: {
      'stock:SYNTH-A': { assetId: 'equity', symbol: 'SYNTH-A', assetType: 'stock', coveredThrough: '2020-01-03T20:00:00Z', points: [{ timestamp: '2020-01-01T20:00:00Z', price: 10 }] },
      'crypto:SYNTH-B': { assetId: 'coin', symbol: 'SYNTH-B', assetType: 'crypto', coveredThrough: '2020-01-03T20:00:00Z', points: [{ timestamp: '2020-01-02T20:00:00Z', price: 100 }, { timestamp: '2020-01-03T20:00:00Z', price: 120 }] }
    } };
    const points = calculateLedgerHistory(ledger, cache, '2020-01-01', '2020-01-03T21:00:00Z');
    expect(points.map(p => p.value)).toEqual([50, 55]);
    expect(points[0].date).toBe('2020-01-02T20:00:00Z');
    ledger.events = ledger.events.filter(e => !('assetId' in e) || e.assetId !== 'equity');
    expect(calculateLedgerHistory(ledger, cache, '2020-01-01', '2020-01-03T21:00:00Z').at(-1)?.value).toBe(30);
  });
  it('carries forward hourly prices for fractional holdings and reconstructs edited quantities', () => {
    const ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'crypto', quantity: 0.25 }], '2020-01-01');
    const cache: LedgerPriceCache = { schemaVersion: 1, entries: { 'crypto:SYNTH': { assetId: 'synthetic', symbol: 'SYNTH', assetType: 'crypto', coveredThrough: '2020-01-02T20:00:00Z', points: [{ timestamp: '2020-01-01T20:00:00Z', price: 40 }, { timestamp: '2020-01-02T20:00:00Z', price: 48 }] } } };
    const history = calculateLedgerHistory(ledger, cache, '2020-01-01', '2020-01-03T00:00:00Z');
    expect(history[0].value).toBe(10);
    expect(history.at(-1)?.value).toBe(12);
    expect(history.some(p => p.value === 0)).toBe(false); // Never invent a missing opening price.
    if ('quantity' in ledger.events[0]) ledger.events[0].quantity = '0.5';
    expect(calculateLedgerHistory(ledger, cache, '2020-01-01', '2020-01-03T00:00:00Z').at(-1)?.value).toBe(24);
  });
  it('does not refetch covered hours and preserves valid cached prices on provider failure', async () => {
    const ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'crypto', quantity: 0.25 }], '2020-01-01');
    const cache: LedgerPriceCache = { schemaVersion: 1, entries: { 'crypto:SYNTH': { assetId: 'synthetic', symbol: 'SYNTH', assetType: 'crypto', coveredThrough: '2020-01-02T20:00:00.000Z', points: [{ timestamp: '2020-01-02T20:00:00.000Z', price: 40 }] } } };
    const getHourlyPrices = vi.fn().mockResolvedValue({ series: [], errors: ['synthetic provider unavailable'] });
    const provider = { getHourlyPrices } as unknown as PriceProvider;
    const covered = await syncLedgerPriceCache(provider, ledger, cache, '2020-01-01', '2020-01-02T20:00:00.000Z');
    expect(covered.changed).toBe(false);
    expect(getHourlyPrices).not.toHaveBeenCalled();
    const failed = await syncLedgerPriceCache(provider, ledger, cache, '2020-01-01', '2020-01-02T21:00:00.000Z');
    expect(failed.cache).toEqual(cache);
    expect(failed.errors).toEqual(['synthetic provider unavailable']);
  });
  it('reconstructs stock, crypto, cash, and debt on every relevant date', () => {
    const ledger: PortfolioLedger = {
      schemaVersion: 2,
      assets: [
        { id: 'stock', symbol: 'AAA', type: 'stock', createdAt },
        { id: 'crypto', symbol: 'BTC', type: 'crypto', createdAt }
      ],
      events: [
        event({ eventType: 'cash_deposit', date: '2026-08-17', amount: '10000' }, 1),
        event({ eventType: 'buy', assetId: 'stock', date: '2026-08-18', quantity: '60', unitPrice: '100', fees: '0', totalAmount: '6000', priceSource: 'manual_total', affectsCashDebt: true }, 2),
        event({ eventType: 'buy', assetId: 'crypto', date: '2026-08-20', quantity: '1', unitPrice: '5000', fees: '0', totalAmount: '5000', priceSource: 'manual_total', affectsCashDebt: true }, 3),
        event({ eventType: 'sell', assetId: 'stock', date: '2026-08-25', quantity: '20', unitPrice: '150', fees: '0', totalAmount: '3000', priceSource: 'manual_total', affectsCashDebt: true }, 4)
      ]
    };
    const cache: LedgerPriceCache = {
      schemaVersion: 1,
      entries: {
        'stock:AAA': { assetId: 'stock', symbol: 'AAA', assetType: 'stock', coveredThrough: '2026-08-25T23:00:00.000Z', points: [
          { timestamp: '2026-08-18T20:00:00.000Z', price: 100 },
          { timestamp: '2026-08-20T20:00:00.000Z', price: 100 },
          { timestamp: '2026-08-25T20:00:00.000Z', price: 150 }
        ] },
        'crypto:BTC': { assetId: 'crypto', symbol: 'BTC', assetType: 'crypto', coveredThrough: '2026-08-25T23:00:00.000Z', points: [
          { timestamp: '2026-08-20T20:00:00.000Z', price: 5000 },
          { timestamp: '2026-08-25T20:00:00.000Z', price: 5000 }
        ] }
      }
    };

    const points = calculateLedgerHistory(ledger, cache, '2026-08-17', '2026-08-25T23:59:59.000Z', 'manual');
    const byDate = new Map(points.map((point) => [calendarDateFromTimestamp(point.date), point.value]));
    expect(byDate.get('2026-08-17')).toBe(10000);
    expect(byDate.get('2026-08-18')).toBe(10000);
    expect(byDate.get('2026-08-20')).toBe(10000);
    expect(byDate.get('2026-08-25')).toBe(13000);
  });

  it('drops cached chart points before a moved earliest Buy in Auto mode', () => {
    const buy = event({ eventType: 'buy', assetId: 'crypto', date: '2026-08-20', quantity: '1', unitPrice: '100', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: false }, 1);
    const ledger: PortfolioLedger = { schemaVersion: 2, assets: [{ id: 'crypto', symbol: 'BTC', type: 'crypto', createdAt }], events: [buy] };
    const cache: LedgerPriceCache = { schemaVersion: 1, entries: { 'crypto:BTC': { assetId: 'crypto', symbol: 'BTC', assetType: 'crypto', coveredThrough: '2026-08-29T23:00:00.000Z', points: [
      { timestamp: '2026-08-17T20:00:00.000Z', price: 100 }, { timestamp: '2026-08-20T20:00:00.000Z', price: 110 }, { timestamp: '2026-08-29T20:00:00.000Z', price: 120 }
    ] } } };
    const points = calculateLedgerHistory(ledger, cache, '2026-08-17', '2026-08-29T23:59:59.000Z', 'auto');
    const byDate = new Map(points.map((point) => [calendarDateFromTimestamp(point.date), point.value]));
    expect(byDate.has('2026-08-17')).toBe(false);
    expect(byDate.get('2026-08-20')).toBe(110);
    expect(byDate.get('2026-08-29')).toBe(120);
  });

  it('honors a manually pinned start before the first Buy', () => {
    const buy = event({ eventType: 'buy', assetId: 'crypto', date: '2026-08-20', quantity: '1', unitPrice: '100', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: false }, 1);
    const ledger: PortfolioLedger = { schemaVersion: 2, assets: [{ id: 'crypto', symbol: 'BTC', type: 'crypto', createdAt }], events: [buy] };
    const cache: LedgerPriceCache = { schemaVersion: 1, entries: { 'crypto:BTC': { assetId: 'crypto', symbol: 'BTC', assetType: 'crypto', coveredThrough: '2026-08-20T23:00:00.000Z', points: [
      { timestamp: '2026-08-17T20:00:00.000Z', price: 90 }, { timestamp: '2026-08-20T20:00:00.000Z', price: 100 }
    ] } } };
    const points = calculateLedgerHistory(ledger, cache, '2026-08-17', '2026-08-20T23:59:59.000Z', 'manual');
    expect(calendarDateFromTimestamp(points[0].date)).toBe('2026-08-17');
    expect(points[0].value).toBe(0);
    expect(points.at(-1)?.value).toBe(100);
  });
});
