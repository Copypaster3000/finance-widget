import { describe, expect, it } from 'vitest';
import { calculateLedgerPortfolio, calculatePortfolio, isQuoteStale, isQuoteUsable, normalizeQuantity } from './portfolio';
import type { Holding, Quote } from './types';

const holdings: Holding[] = [
  { id: 'a', symbol: 'AAA', type: 'stock', quantity: 2.5 },
  { id: 'b', symbol: 'BTC', type: 'crypto', quantity: 0.125 }
];
const quotes: Quote[] = [
  { symbol: 'AAA', assetType: 'stock', price: 100, previousClose: 90, currency: 'USD', timestamp: 1000, provider: 'test', status: 'live' },
  { symbol: 'BTC', assetType: 'crypto', price: 2000, previousClose: 1900, currency: 'USD', timestamp: 1000, provider: 'test', status: 'live' }
];

describe('portfolio calculations', () => {
  it('calculates fractional position values and total value', () => {
    const result = calculatePortfolio(holdings, quotes);
    expect(result.positions.map((position) => position.value)).toEqual([250, 250]);
    expect(result.totalValue).toBe(500);
  });

  it('calculates allocations that sum to 100 percent', () => {
    const result = calculatePortfolio(holdings, quotes);
    expect(result.positions[0].allocation).toBe(50);
    expect(result.positions.reduce((sum, position) => sum + position.allocation, 0)).toBeCloseTo(100);
  });

  it('orders positions from highest to lowest market value', () => {
    const orderedHoldings: Holding[] = [
      { id: 'small', symbol: 'SMALL', type: 'stock', quantity: 1 },
      { id: 'missing', symbol: 'MISSING', type: 'stock', quantity: 20 },
      { id: 'large', symbol: 'LARGE', type: 'stock', quantity: 4 }
    ];
    const orderedQuotes: Quote[] = [
      { symbol: 'SMALL', assetType: 'stock', price: 25, currency: 'USD', timestamp: 1, provider: 'test', status: 'live' },
      { symbol: 'LARGE', assetType: 'stock', price: 100, currency: 'USD', timestamp: 1, provider: 'test', status: 'live' }
    ];

    const result = calculatePortfolio(orderedHoldings, orderedQuotes);

    expect(result.positions.map((position) => position.symbol)).toEqual(['LARGE', 'SMALL', 'MISSING']);
    expect(result.positions.map((position) => position.value)).toEqual([400, 25, 0]);
  });

  it('handles a zero-value portfolio', () => {
    const result = calculatePortfolio([{ ...holdings[0], quantity: 0 }], []);
    expect(result.totalValue).toBe(0);
    expect(result.positions[0].allocation).toBe(0);
  });

  it('normalizes invalid and negative quantities without NaN', () => {
    expect(normalizeQuantity('bad')).toBe(0);
    expect(normalizeQuantity(-2)).toBe(0);
    expect(normalizeQuantity('1.25')).toBe(1.25);
  });

  it('keeps a missing quote as an unpriced position', () => {
    const result = calculatePortfolio(holdings, [quotes[0]]);
    expect(result.positions[1].quote).toBeUndefined();
    expect(result.positions[1].value).toBe(0);
  });

  it('rejects malformed prices and detects stale quotes', () => {
    expect(isQuoteUsable({ price: Number.NaN })).toBe(false);
    expect(isQuoteUsable({ price: 42 })).toBe(true);
    expect(isQuoteStale(quotes[0], 1000 + 16 * 60_000)).toBe(true);
  });
});

describe('ledger portfolio valuation', () => {
  it('uses net value for the headline and gross assets for allocations', () => {
    const result = calculateLedgerPortfolio({
      cash: 200,
      debt: 500,
      positions: [{
        asset: { id: 'a', symbol: 'AAA', type: 'stock', createdAt: '2026-08-17T00:00:00.000Z' },
        quantity: 10,
        quantityDecimal: '10',
        remainingCostBasis: 800,
        averageCost: 80,
        realizedGain: 0,
        lots: []
      }]
    }, [{ symbol: 'AAA', assetType: 'stock', price: 100, currency: 'USD', timestamp: 1, provider: 'test', status: 'live' }]);
    expect(result.grossAssets).toBe(1200);
    expect(result.totalValue).toBe(700);
    expect(result.positions.find((position) => position.type === 'stock')?.allocation).toBeCloseTo(83.3333);
    expect(result.positions.find((position) => position.type === 'cash')?.allocation).toBeCloseTo(16.6667);
    expect(result.positions.find((position) => position.type === 'debt')?.allocation).toBeCloseTo(41.6667);
    expect(result.investmentPositionCount).toBe(1);
  });

  it('does not count Cash or Debt as investment positions', () => {
    const result = calculateLedgerPortfolio({ cash: 0, debt: 0, positions: [] }, []);
    expect(result.investmentPositionCount).toBe(0);
    expect(result.positions).toHaveLength(2);
  });

  it('values Cash-only and Debt-only portfolios without inventing positions', () => {
    const cashOnly = calculateLedgerPortfolio({ cash: 250, debt: 0, positions: [] }, []);
    const debtOnly = calculateLedgerPortfolio({ cash: 0, debt: 400, positions: [] }, []);
    expect(cashOnly).toMatchObject({ totalValue: 250, grossAssets: 250, investmentPositionCount: 0 });
    expect(debtOnly).toMatchObject({ totalValue: -400, grossAssets: 0, investmentPositionCount: 0 });
  });

  it('preserves a negative net portfolio value', () => {
    const result = calculateLedgerPortfolio({ cash: 25, debt: 100, positions: [] }, []);
    expect(result.totalValue).toBe(-75);
  });
});
