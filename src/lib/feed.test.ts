import { describe, expect, it } from 'vitest';
import { detectPriceSourceTransition, feedLabel, mergeIncomingQuotes, preferredStoredQuotes, resolveFeedState, summarizeHistoryErrors, valuationLabel } from './feed';
import type { FeedStatus, Holding, Quote } from './types';

const holding: Holding = { id: 'a', symbol: 'AAA', type: 'stock', quantity: 1 };
const quote = (status: Quote['status'], price: number, timestamp = 1_000): Quote => ({ symbol: 'AAA', assetType: 'stock', price, currency: 'USD', timestamp, provider: status === 'mock' ? 'Demo feed' : 'Yahoo Finance', status });
const feed = (state: FeedStatus['state']): FeedStatus => ({ state, provider: 'Yahoo Finance', lastCheckedAt: 0, lastQuoteReceivedAt: 0 });

describe('quote provenance', () => {
  it('never prefers demo data for a production portfolio', () => {
    expect(preferredStoredQuotes([quote('mock', 500), quote('cached', 100, 900)], [holding], 1_000)).toEqual([quote('cached', 100, 900)]);
    expect(preferredStoredQuotes([quote('mock', 500)], [holding], 1_000)).toEqual([]);
  });

  it('represents demo and incomplete valuations explicitly', () => {
    expect(feedLabel(feed('demo'))).toBe('DEMO / NOT LIVE');
    expect(valuationLabel(feed('demo'), 0)).toBe('DEMO VALUATION');
    expect(valuationLabel(feed('live'), 1)).toBe('PARTIAL VALUATION');
  });

  it('detects a material cached-to-provider reprice', () => {
    expect(detectPriceSourceTransition(100, 96, [quote('cached', 100)], [quote('delayed', 96)], 5_000)).toMatchObject({ from: 'Cache', to: 'YAHOO', delta: -4, deltaPercent: -4 });
    expect(detectPriceSourceTransition(100, 99, [quote('cached', 100)], [quote('delayed', 99)], 5_000)).toBeUndefined();
  });

  it('turns raw history errors into affected symbols', () => {
    expect(summarizeHistoryErrors(['TESTA: Yahoo hourly history unavailable', 'TESTB: Yahoo HTTP 404'])).toMatchObject({ symbols: ['TESTA', 'TESTB'] });
  });

  it('retains prior real quotes when a refresh returns no replacement', () => {
    expect(mergeIncomingQuotes([quote('cached', 100)], [], [holding])).toEqual([quote('cached', 100)]);
  });

  it('keeps timed stock refresh visibly active while the market is closed', () => {
    expect(resolveFeedState({ holdingCount: 1, hasStocks: true, hasCrypto: false, stockSessionActive: false, errorCount: 0, receivedCount: 0, availableCount: 1, hasLive: false })).toBe('market_closed');
  });
});
