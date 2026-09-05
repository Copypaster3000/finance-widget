import { MAX_PRICE } from './decimal';
import { localCalendarDate } from './calendar';
import { isUsEquityExtendedSessionOpen, isUsEquityMarketOpen } from './market';
import type { Quote, StockSession, TransactionPriceResolution } from './types';
import { withTimeout } from './requests';

export const QUOTE_MAX_AGE = 15 * 60_000;
export const FUTURE_TOLERANCE = 5 * 60_000;
/** Zero means unknown market time, never the time the request was received. */
export function validQuote(value: unknown, now = Date.now()): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const q = value as Quote;
  return typeof q.symbol === 'string' && q.symbol.trim().length > 0 && ['stock','crypto'].includes(q.assetType)
    && q.currency === 'USD' && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 && q.price <= MAX_PRICE
    && typeof q.timestamp === 'number' && Number.isFinite(q.timestamp) && q.timestamp >= 0 && q.timestamp <= now + FUTURE_TOLERANCE
    && typeof q.provider === 'string' && ['live','delayed','cached','mock'].includes(q.status);
}
export function sanitizeQuotes(value: unknown, now = Date.now()): Quote[] {
  if (!Array.isArray(value)) return [];
  return value.filter(q => validQuote(q, now)).map(q => ({...q, previousClose: typeof q.previousClose === 'number' && q.previousClose > 0 && q.previousClose <= MAX_PRICE ? q.previousClose : undefined}));
}
export function quoteFreshness(q: Quote, now = Date.now(), session: StockSession = 'regular'): 'fresh' | 'closed' | 'stale' | 'unavailable' {
  if (!validQuote(q, now) || q.status === 'mock' || !q.timestamp) return 'unavailable';
  if (now - q.timestamp <= QUOTE_MAX_AGE) return 'fresh';
  const open = session === 'extended' ? isUsEquityExtendedSessionOpen(now) : isUsEquityMarketOpen(now);
  // Conservative weekend/holiday allowance. Closed-market prices still need confirmation for trades.
  if (q.assetType === 'stock' && !open && now - q.timestamp <= 4 * 86_400_000) return 'closed';
  return 'stale';
}
export function quoteTradePrice(q: Quote, now = Date.now(), session: StockSession = 'regular'): TransactionPriceResolution | undefined {
  const freshness = quoteFreshness(q, now, session);
  if (freshness === 'unavailable') return undefined;
  return { unitPrice: q.price.toFixed(6), priceDate: localCalendarDate(q.timestamp), marketTimestamp: q.timestamp,
    source: freshness === 'fresh' ? 'current_quote' : freshness === 'closed' ? 'previous_trading_close' : 'stale_quote_confirmed', requiresConfirmation: freshness !== 'fresh' };
}

export async function resolveCurrentTradePrice(existing: Quote | undefined, fetchLatest: () => Promise<Quote[]>, session: StockSession, clock = Date.now): Promise<TransactionPriceResolution> {
  let q = existing && validQuote(existing, clock()) && existing.status !== 'mock' ? existing : undefined;
  if (!q || quoteFreshness(q, clock(), session) !== 'fresh') {
    try { const candidates = sanitizeQuotes(await withTimeout(fetchLatest()), clock()).filter(next => next.status !== 'mock');
      for (const next of candidates) if (!q || next.timestamp > q.timestamp || (next.session && q.session && next.session !== q.session)) q = next;
    } catch { /* A stale fallback is only usable with explicit confirmation. */ }
  }
  const resolution = q && quoteTradePrice(q, clock(), session);
  if (!resolution) throw new Error('No verified USD market timestamp. Enter the transaction price manually.');
  return resolution;
}
