import { describe, expect, it, vi } from 'vitest';
import { calculateHistoryChange, cachedSeries, historyKey, syncHistoricalCache } from './history';
import type { HistoricalCache, HistoricalSeries, Holding, PriceProvider } from './types';

const stock = (id: string, symbol: string, quantity: number): Holding => ({ id, symbol, type: 'stock', quantity });
const series = (symbol: string, assetType: Holding['type'], values: Array<[string, number]>): HistoricalSeries => ({ symbol, assetType, points: values.map(([date, price]) => ({ date, price })) });

describe('portfolio history calculations', () => {
  it('handles a zero-value portfolio and a zero starting value safely', () => {
    expect(calculateHistoryChange([{ date: '2026-08-17', value: 0 }, { date: '2026-08-18', value: 10 }])).toBe(0);
  });

  it('calculates change relative to the configured first point', () => {
    expect(calculateHistoryChange([{ date: '2026-08-17', value: 80 }, { date: '2026-08-18', value: 100 }])).toBe(25);
  });
});

describe('historical cache', () => {
  it('does not refetch covered completed days when quantity changes', async () => {
    const holding = stock('a', 'AAA', 1);
    const cache: HistoricalCache = {
      [historyKey('mock', 'stock', 'AAA')]: { provider: 'mock', symbol: 'AAA', assetType: 'stock', coveredStart: '2026-08-17', coveredEnd: '2026-08-23', points: [{ date: '2026-08-21', price: 10 }] }
    };
    const getHistoricalPrices = vi.fn();
    const provider = { id: 'mock', name: 'test', getQuotes: vi.fn(), getHistoricalPrices, supportsStreaming: () => false } as unknown as PriceProvider;
    const result = await syncHistoricalCache(provider, 'mock', [{ ...holding, quantity: 9 }], cache, '2026-08-17', '2026-08-23');
    expect(getHistoricalPrices).not.toHaveBeenCalled();
    expect(cachedSeries(result.cache, 'mock', [holding])[0].points).toHaveLength(1);
  });

  it('fetches only an earlier missing range when the start date moves back', async () => {
    const holding = stock('a', 'AAA', 1);
    const cache: HistoricalCache = {
      [historyKey('mock', 'stock', 'AAA')]: { provider: 'mock', symbol: 'AAA', assetType: 'stock', coveredStart: '2026-08-17', coveredEnd: '2026-08-23', points: [] }
    };
    const getHistoricalPrices = vi.fn(async (_holdings, startDate, endDate) => ({ series: [series('AAA', 'stock', [[startDate, 9]])], errors: [] }));
    const provider = { id: 'mock', name: 'test', getQuotes: vi.fn(), getHistoricalPrices, supportsStreaming: () => false } as unknown as PriceProvider;
    await syncHistoricalCache(provider, 'mock', [holding], cache, '2026-08-10', '2026-08-23');
    expect(getHistoricalPrices).toHaveBeenCalledWith([holding], '2026-08-10', '2026-08-16');
  });
});
