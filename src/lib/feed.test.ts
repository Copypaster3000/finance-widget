import { describe, expect, it } from 'vitest';
import { detectPriceSourceTransition, feedLabel, mergeIncomingQuotes, preferredStoredQuotes, resolveFeedState, sourceName, summarizeHistoryErrors, valuationLabel } from './feed';
import type { FeedStatus, Holding, Quote } from './types';

const holding: Holding = { id: 'a', symbol: 'AAA', type: 'stock', quantity: 1 };
const quote = (status: Quote['status'], price: number, timestamp = 1_000): Quote => ({ symbol: 'AAA', assetType: 'stock', price, currency: 'USD', timestamp, provider: status === 'mock' ? 'Demo feed' : 'Yahoo Finance', status });
const feed = (state: FeedStatus['state']): FeedStatus => ({ state, provider: 'Yahoo Finance', lastCheckedAt: 0, lastQuoteReceivedAt: 0 });

describe('quote provenance', () => {
  const mixed = [quote('cached', 100), { ...quote('delayed', 100), symbol: 'BBB' }];
  const provider = mixed.map(q => ({ ...q, status: 'delayed' as const }));

  it.each([
    ['cached', [quote('cached', 100)], [quote('cached', 140)]],
    ['mixed', mixed, mixed.map(q => ({ ...q, price: 140, timestamp: 2000 })).reverse()],
    ['live/delayed', [quote('live', 100)], [quote('delayed', 140)]],
  ])('does not announce unchanged %s provenance despite material price movement', (_name, before, after) => {
    expect(detectPriceSourceTransition(100, 140, before as Quote[], after as Quote[])).toBeUndefined();
  });

  it.each([
    [[quote('delayed', 100)], [quote('cached', 90)], 'YAHOO', 'Cache'],
    [mixed, provider, 'Mixed (Cache: 1, YAHOO: 1)', 'YAHOO'],
    [provider, mixed, 'YAHOO', 'Mixed (Cache: 1, YAHOO: 1)'],
    [provider.map(q => ({ ...q, status: 'cached' as const })), mixed, 'Cache', 'Mixed (Cache: 1, YAHOO: 1)'],
  ])('describes a material transition accurately', (before, after, from, to) => {
    expect(detectPriceSourceTransition(100, 90, before, after)).toMatchObject({ from, to, delta: -10, deltaPercent: -10 });
  });

  it('preserves repricing when mixed components are shared or swap assets', () => {
    const swapped = mixed.map(q => ({ ...q, status: q.status === 'cached' ? 'delayed' as const : 'cached' as const }));
    const notice = detectPriceSourceTransition(100, 80, mixed, swapped)!;
    expect(notice.from).toContain('stock:AAA: Cache');
    expect(notice.to).toContain('stock:AAA: YAHOO');
    expect(notice.from).not.toBe(notice.to);
    const three = [...mixed, { ...quote('cached', 100), symbol: 'CCC' }];
    expect(detectPriceSourceTransition(100, 80, three, [...provider, three[2]])).toMatchObject({ from: 'Mixed (Cache: 2, YAHOO: 1)', to: 'Mixed (Cache: 1, YAHOO: 2)' });
  });

  it('does not attribute quantity or asset membership changes to provenance', () => {
    expect(detectPriceSourceTransition(100, 400, mixed, mixed)).toBeUndefined();
    expect(detectPriceSourceTransition(100, 400, [mixed[0]], mixed)).toBeUndefined();
  });

  it('uses compatible aggregate labels in the footer, including cached received quotes', () => {
    expect(sourceName(mixed)).toBe('Mixed (Cache: 1, YAHOO: 1)');
    expect(feedLabel(feed('delayed'), mixed)).toBe('MIXED (CACHE: 1, YAHOO: 1) / DELAYED');
    expect(feedLabel(feed('delayed'), [quote('cached', 100)])).toBe('CACHE / STALE');
    expect(feedLabel(feed('delayed'), provider)).toBe('YAHOO / DELAYED');
  });
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
