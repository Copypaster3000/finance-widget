import { describe, expect, it } from 'vitest';
import { applyYahooSessionQuote, normalizeYahooHistory, normalizeYahooHourly, normalizeYahooQuote, yahooHourlyParams, yahooQuoteParams, yahooSymbol } from './providers';
import type { Holding } from './types';

const listed: Holding = { id: 'listed', symbol: 'TESTA', type: 'stock', quantity: 1 };
const otc: Holding = { id: 'otc', symbol: 'TESTB', type: 'stock', quantity: 1 };
const crypto: Holding = { id: 'crypto', symbol: 'COIN', type: 'crypto', quantity: 1 };

describe('Yahoo Finance normalization', () => {
  it('maps stocks and crypto to Yahoo chart symbols', () => {
    expect(yahooSymbol(listed)).toBe('TESTA');
    expect(yahooSymbol(otc)).toBe('TESTB');
    expect(yahooSymbol(crypto)).toBe('COIN-USD');
  });

  it('requests one-minute pre/post bars only for stocks in extended mode', () => {
    expect(Object.fromEntries(yahooQuoteParams(listed, true))).toMatchObject({ range: '1d', interval: '1m', includePrePost: 'true' });
    expect(Object.fromEntries(yahooQuoteParams(listed, false))).toMatchObject({ range: '5d', interval: '1d', includePrePost: 'false' });
    expect(Object.fromEntries(yahooQuoteParams(crypto, true))).toMatchObject({ range: '5d', interval: '1d', includePrePost: 'false' });
    expect(yahooHourlyParams(listed, '2026-08-24T20:00:00.000Z', '2026-08-24T21:00:00.000Z', true).get('includePrePost')).toBe('true');
    expect(yahooHourlyParams(listed, '2026-08-24T20:00:00.000Z', '2026-08-24T21:00:00.000Z', false).get('includePrePost')).toBe('false');
  });

  it('normalizes an OTC quote conservatively as delayed', () => {
    const quote = normalizeYahooQuote({ chart: { result: [{ meta: {
      regularMarketPrice: 25, regularMarketPreviousClose: 24, currency: 'USD', regularMarketTime: 1_787_558_400
    } }] } }, otc);
    expect(quote).toMatchObject({ symbol: 'TESTB', price: 25, previousClose: 24, status: 'delayed', provider: 'Yahoo Finance' });
    expect(quote.change).toBeCloseTo(1);
    expect(quote.changePercent).toBeCloseTo(4.1667, 3);
    expect(quote.timestamp).toBe(1_787_558_400_000);
  });

  it('derives the previous session close instead of using the five-day chart baseline', () => {
    const quote = normalizeYahooQuote({ chart: { result: [{
      meta: { regularMarketPrice: 50, chartPreviousClose: 42, currency: 'USD', regularMarketTime: 1_787_601_570 },
      indicators: { quote: [{ close: [44, 46, 48, 51, 50] }] }
    }] } }, otc);

    expect(quote.previousClose).toBe(51);
    expect(quote.change).toBeCloseTo(-1);
    expect(quote.changePercent).toBeCloseTo(-1.9608, 3);
  });

  it('uses a newer extended-hours bar only when extended stock pricing is enabled', () => {
    const payload = { chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketPreviousClose: 90, regularMarketTime: 1_000, currency: 'USD' },
      timestamp: [990, 1_100, 1_200],
      indicators: { quote: [{ close: [99, 101, null] }] }
    }] } };
    expect(normalizeYahooQuote(payload, listed)).toMatchObject({ price: 100, timestamp: 1_000_000 });
    expect(normalizeYahooQuote(payload, listed, true)).toMatchObject({ price: 101, timestamp: 1_100_000, previousClose: 90 });
    expect(normalizeYahooQuote(payload, crypto, true)).toMatchObject({ price: 100, timestamp: 1_000_000 });
  });

  it('does not mistake the prior minute for the previous daily close in extended mode', () => {
    const quote = normalizeYahooQuote({ chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketTime: 1_000, currency: 'USD' },
      timestamp: [1_100, 1_200],
      indicators: { quote: [{ close: [101, 102] }] }
    }] } }, listed, true);
    expect(quote).toMatchObject({ price: 102, timestamp: 1_200_000 });
    expect(quote.previousClose).toBeUndefined();
    expect(quote.changePercent).toBeUndefined();
  });

  it('uses the newest Yahoo session quote, including overnight, and recalculates daily change', () => {
    const chartQuote = normalizeYahooQuote({ chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketPreviousClose: 95, regularMarketTime: 1_000, currency: 'USD' },
      timestamp: [1_100], indicators: { quote: [{ close: [101] }] }
    }] } }, listed, true);
    const quote = applyYahooSessionQuote(chartQuote, {
      symbol: 'TESTA', currency: 'USD', postMarketPrice: 101, postMarketTime: 1_100,
      overnightMarketPrice: 103, overnightMarketTime: 1_200
    }, listed);
    expect(quote).toMatchObject({ price: 103, timestamp: 1_200_000, previousClose: 95 });
    expect(quote.change).toBeCloseTo(8);
    expect(quote.changePercent).toBeCloseTo(8.4211, 3);
  });

  it('keeps a newer chart quote when session data is stale or unavailable', () => {
    const quote = normalizeYahooQuote({ chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketPreviousClose: 90, regularMarketTime: 1_000, currency: 'USD' },
      timestamp: [1_200], indicators: { quote: [{ close: [102] }] }
    }] } }, listed, true);
    expect(applyYahooSessionQuote(quote, { overnightMarketPrice: 101, overnightMarketTime: 1_100 }, listed)).toEqual(quote);
    expect(applyYahooSessionQuote(quote, undefined, listed)).toEqual(quote);
    expect(applyYahooSessionQuote(quote, { overnightMarketPrice: 110, overnightMarketTime: 1_300 }, crypto)).toEqual(quote);
  });

  it('normalizes sorted EOD history and rejects unavailable data', () => {
    const payload = { chart: { result: [{
      timestamp: [1_786_924_800, 1_787_011_200, 1_787_097_600],
      meta: { currency: 'USD' },
      indicators: { quote: [{ close: [4, null, 4.2] }] }
    }] } };
    expect(normalizeYahooHistory(payload, otc, '2026-08-17', '2026-08-19')).toEqual([
      { date: '2026-08-17', price: 4 }, { date: '2026-08-19', price: 4.2 }
    ]);
    expect(() => normalizeYahooQuote({ chart: { result: [] } }, otc)).toThrow(/unavailable/i);
    expect(() => normalizeYahooHistory({ chart: { error: { description: 'rate limited' } } }, otc, '2026-08-17', '2026-08-19')).toThrow(/rate limited/i);
    expect(() => normalizeYahooHistory({ chart: { result: [{ meta: {currency:'USD'}, timestamp: [1_786_924_800], indicators: { quote: [{ close: [null] }] } }] } }, otc, '2026-08-17', '2026-08-19')).toThrow(/malformed/i);
  });

  it('normalizes UTC hourly bars and rejects malformed hourly data', () => {
    const payload = { chart: { result: [{
      timestamp: [1_786_924_800, 1_786_928_400],
      meta: { currency: 'USD' },
      indicators: { quote: [{ close: [4, 4.1] }] }
    }] } };
    expect(normalizeYahooHourly(payload, otc, '2026-08-17T00:00:00.000Z', '2026-08-17T01:00:00.000Z')).toEqual([
      { timestamp: '2026-08-17T00:00:00.000Z', price: 4 },
      { timestamp: '2026-08-17T01:00:00.000Z', price: 4.1 }
    ]);
    expect(() => normalizeYahooHourly({ chart: { result: [{ meta: {currency:'USD'}, timestamp: [1_786_924_800] }] } }, otc, '2026-08-17T00:00:00.000Z', '2026-08-17T01:00:00.000Z')).toThrow(/unavailable/i);
  });
});
