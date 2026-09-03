import { describe, expect, it, vi } from 'vitest';
import { calculateHistoryChange, calculatePortfolioHistory, cachedSeries, historyKey, syncHistoricalCache } from './history';
import type { HistoricalCache, HistoricalSeries, Holding, PriceProvider, Quote } from './types';

const stock = (id: string, symbol: string, quantity: number): Holding => ({ id, symbol, type: 'stock', quantity });
const crypto = (id: string, symbol: string, quantity: number): Holding => ({ id, symbol, type: 'crypto', quantity });
const quote = (symbol: string, assetType: Holding['type'], price: number): Quote => ({ symbol, assetType, price, currency: 'USD', timestamp: 1, provider: 'test', status: 'live' });
const series = (symbol: string, assetType: Holding['type'], values: Array<[string, number]>): HistoricalSeries => ({ symbol, assetType, points: values.map(([date, price]) => ({ date, price })) });

describe('portfolio history calculations', () => {
  it('values one holding and integrates the latest quote', () => {
    const result = calculatePortfolioHistory([stock('a', 'AAA', 2)], [series('AAA', 'stock', [['2026-08-17', 10]])], [quote('AAA', 'stock', 12)], '2026-08-17', '2026-08-18');
    expect(result.map((point) => point.value)).toEqual([20, 24]);
  });

  it('sums multiple holdings including fractional quantities', () => {
    const result = calculatePortfolioHistory(
      [stock('a', 'AAA', 2.5), crypto('b', 'BTC', 0.25)],
      [series('AAA', 'stock', [['2026-08-17', 10]]), series('BTC', 'crypto', [['2026-08-17', 100]])],
      [quote('AAA', 'stock', 11), quote('BTC', 'crypto', 120)], '2026-08-17', '2026-08-18'
    );
    expect(result.map((point) => point.value)).toEqual([50, 57.5]);
  });

  it('carries stock prices through a weekend while crypto remains daily', () => {
    const result = calculatePortfolioHistory(
      [stock('a', 'AAA', 1), crypto('b', 'BTC', 1)],
      [series('AAA', 'stock', [['2026-08-21', 10], ['2026-08-24', 12]]), series('BTC', 'crypto', [['2026-08-21', 20], ['2026-08-22', 21], ['2026-08-23', 22], ['2026-08-24', 23]])],
      [quote('AAA', 'stock', 12), quote('BTC', 'crypto', 23)], '2026-08-21', '2026-08-24'
    );
    expect(result.map((point) => point.value)).toEqual([30, 31, 32, 35]);
  });

  it('starts at the earliest common valid date rather than substituting zero', () => {
    const result = calculatePortfolioHistory(
      [stock('a', 'AAA', 1), stock('b', 'BBB', 1)],
      [series('AAA', 'stock', [['2026-08-17', 10], ['2026-08-18', 11]]), series('BBB', 'stock', [['2026-08-18', 20]])],
      [], '2026-08-17', '2026-08-19'
    );
    expect(result).toEqual([{ date: '2026-08-18', value: 31 }, { date: '2026-08-19', value: 31 }]);
  });

  it('recalculates history after a quantity edit or holding removal', () => {
    const data = [series('AAA', 'stock', [['2026-08-17', 10]]), series('BBB', 'stock', [['2026-08-17', 20]])];
    expect(calculatePortfolioHistory([stock('a', 'AAA', 2), stock('b', 'BBB', 1)], data, [], '2026-08-17', '2026-08-17')[0].value).toBe(40);
    expect(calculatePortfolioHistory([stock('a', 'AAA', 3)], data, [], '2026-08-17', '2026-08-17')[0].value).toBe(30);
  });

  it('handles a zero-value portfolio and a zero starting value safely', () => {
    expect(calculatePortfolioHistory([stock('a', 'AAA', 0)], [], [], '2026-08-17', '2026-08-18')).toEqual([]);
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
