import { isQuoteStale } from './portfolio';
import type { FeedState, FeedStatus, HistoryWarning, Holding, PriceSourceTransition, Quote } from './types';

const MATERIAL_DELTA = 0.02;

function key(value: Pick<Quote, 'assetType' | 'symbol'> | Pick<Holding, 'type' | 'symbol'>): string {
  const type = 'assetType' in value ? value.assetType : value.type;
  return `${type}:${value.symbol.trim().toUpperCase()}`;
}

export function providerLabel(provider?: string): string {
  if (!provider) return 'PRICE FEED';
  if (/yahoo/i.test(provider)) return 'YAHOO';
  if (/demo/i.test(provider)) return 'DEMO';
  return provider.toUpperCase();
}

export function preferredStoredQuotes(quotes: Quote[], holdings: Holding[], now = Date.now(), allowDemo = false): Quote[] {
  const active = new Set(holdings.map(key));
  const selected = new Map<string, Quote>();
  for (const quote of quotes) {
    if (!active.has(key(quote)) || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.timestamp)) continue;
    if (quote.status === 'mock' && !allowDemo) continue;
    const normalized = quote.status !== 'mock' && isQuoteStale(quote, now) ? { ...quote, status: 'cached' as const } : quote;
    const existing = selected.get(key(quote));
    if (!existing || normalized.timestamp > existing.timestamp || (existing.status === 'mock' && normalized.status !== 'mock')) selected.set(key(quote), normalized);
  }
  return [...selected.values()];
}

export function missingQuoteCount(quotes: Quote[], holdings: Holding[]): number {
  const available = new Set(quotes.filter((quote) => quote.status !== 'mock').map(key));
  return holdings.filter((holding) => !available.has(key(holding))).length;
}

export function mergeIncomingQuotes(previous: Quote[], incoming: Quote[], holdings: Holding[]): Quote[] {
  const active = new Set(holdings.map(key));
  const received = new Set(incoming.map(key));
  return [...incoming, ...previous.filter((quote) => quote.status !== 'mock' && active.has(key(quote)) && !received.has(key(quote)))];
}

export function resolveFeedState(input: { holdingCount: number; hasStocks: boolean; hasCrypto: boolean; stockSessionActive: boolean; errorCount: number; receivedCount: number; availableCount: number; hasLive: boolean }): FeedState {
  if (!input.holdingCount) return 'idle';
  if (input.errorCount) return input.receivedCount ? 'partial' : input.availableCount ? 'offline' : 'unavailable';
  if (!input.stockSessionActive && input.hasStocks && !input.hasCrypto) return 'market_closed';
  if (input.availableCount < input.holdingCount) return 'partial';
  if (input.hasLive) return 'live';
  if (input.receivedCount) return 'delayed';
  if (input.availableCount) return 'cached';
  return 'unavailable';
}

function sourceName(quotes: Quote[]): string {
  if (quotes.some((quote) => quote.status === 'mock')) return 'Demo';
  if (quotes.some((quote) => quote.status === 'cached')) return 'Cache';
  return providerLabel(quotes[0]?.provider).replaceAll('_', ' ');
}

export function detectPriceSourceTransition(beforeValue: number, afterValue: number, beforeQuotes: Quote[], afterQuotes: Quote[], now = Date.now(), threshold = MATERIAL_DELTA): PriceSourceTransition | undefined {
  if (!beforeQuotes.length || !afterQuotes.length || !Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) return undefined;
  const denominator = Math.max(Math.abs(beforeValue), 0.01);
  const delta = afterValue - beforeValue;
  const deltaPercent = delta / denominator;
  const from = sourceName(beforeQuotes);
  const to = sourceName(afterQuotes);
  const provenanceChanged = from !== to || beforeQuotes.some((quote) => quote.status === 'cached' || quote.status === 'mock');
  if (!provenanceChanged || Math.abs(deltaPercent) <= threshold) return undefined;
  return { from, to, delta, deltaPercent: deltaPercent * 100, detectedAt: now };
}

export function feedLabel(feed: FeedStatus): string {
  const provider = providerLabel(feed.provider);
  if (feed.state === 'updating') return 'UPDATING';
  if (feed.state === 'market_closed') return `${provider} / MARKET CLOSED`;
  if (feed.state === 'live') return `${provider} / LIVE`;
  if (feed.state === 'delayed') return `${provider} / DELAYED`;
  if (feed.state === 'cached') return 'CACHE / STALE';
  if (feed.state === 'demo') return 'DEMO / NOT LIVE';
  if (feed.state === 'partial') return `${provider} / PARTIAL`;
  if (feed.state === 'offline') return 'OFFLINE / CACHED';
  if (feed.state === 'unavailable') return 'PRICE UNAVAILABLE';
  return 'WAITING FOR PRICES';
}

export function valuationLabel(feed: FeedStatus, missing: number): string {
  if (feed.state === 'demo') return 'DEMO VALUATION';
  if (missing > 0 || feed.state === 'partial' || feed.state === 'unavailable') return 'PARTIAL VALUATION';
  if (feed.state === 'cached' || feed.state === 'offline') return 'CACHED VALUATION';
  return '';
}

export function feedTooltip(feed: FeedStatus, quotes: Quote[]): string {
  const lines = [feedLabel(feed)];
  const newest = quotes.length ? Math.max(...quotes.map((quote) => quote.timestamp)) : 0;
  if (newest) lines.push(`Newest market quote: ${new Date(newest).toLocaleTimeString()}`);
  if (feed.lastQuoteReceivedAt) lines.push(`Last quote received: ${new Date(feed.lastQuoteReceivedAt).toLocaleTimeString()}`);
  if (feed.lastCheckedAt) lines.push(`Last checked: ${new Date(feed.lastCheckedAt).toLocaleTimeString()}`);
  if (feed.state === 'demo') lines.push('Values are simulated and are not current market prices.');
  if (feed.detail) lines.push(feed.detail);
  return lines.join('\n');
}

export function summarizeHistoryErrors(errors: string[]): HistoryWarning | undefined {
  if (!errors.length) return undefined;
  const symbols = [...new Set(errors.flatMap((message) => {
    const match = /^\s*([A-Z0-9.^=-]+)\s*:/i.exec(message);
    return match ? [match[1].toUpperCase()] : [];
  }))];
  return { symbols, detail: errors.join(' / ') };
}
