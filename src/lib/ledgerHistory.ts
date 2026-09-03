import { replayLedger } from './ledger';
import { calendarDateFromTimestamp, localCalendarEndTimestamp, localCalendarStartTimestamp } from './calendar';
import type { HistoryStartMode, Holding, HourlyPricePoint, LedgerPriceCache, LedgerPriceCacheEntry, PortfolioHistoryPoint, PortfolioLedger, PriceProvider, Quote } from './types';

const HOUR_MS = 3_600_000;
export const EMPTY_LEDGER_PRICE_CACHE: LedgerPriceCache = { schemaVersion: 1, entries: {} };

function key(type: string, symbol: string): string { return `${type}:${symbol.trim().toUpperCase()}`; }

function validPoint(value: unknown): value is HourlyPricePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<HourlyPricePoint>;
  return typeof point.timestamp === 'string' && Number.isFinite(Date.parse(point.timestamp)) && typeof point.price === 'number' && Number.isFinite(point.price) && point.price > 0;
}

function sanitizePoints(value: unknown): HourlyPricePoint[] {
  if (!Array.isArray(value)) return [];
  return [...new Map(value.filter(validPoint).map((point) => [point.timestamp, point])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function sanitizeLedgerPriceCache(value: unknown): LedgerPriceCache {
  if (!value || typeof value !== 'object' || (value as Partial<LedgerPriceCache>).schemaVersion !== 1) return structuredClone(EMPTY_LEDGER_PRICE_CACHE);
  const entries = Object.fromEntries(Object.entries((value as Partial<LedgerPriceCache>).entries ?? {}).flatMap(([entryKey, raw]) => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Partial<LedgerPriceCacheEntry>;
    if (!entry.assetId || !entry.symbol || !['stock', 'crypto'].includes(entry.assetType ?? '') || !entry.coveredThrough || !Number.isFinite(Date.parse(entry.coveredThrough))) return [];
    return [[entryKey, { assetId: entry.assetId, symbol: entry.symbol.toUpperCase(), assetType: entry.assetType, coveredThrough: entry.coveredThrough, points: sanitizePoints(entry.points) } as LedgerPriceCacheEntry]];
  }));
  return { schemaVersion: 1, entries };
}

export async function syncLedgerPriceCache(
  provider: PriceProvider,
  ledger: PortfolioLedger,
  cacheValue: LedgerPriceCache,
  historyStartDate: string,
  endTime: string
): Promise<{ cache: LedgerPriceCache; errors: string[]; changed: boolean }> {
  if (!provider.getHourlyPrices) return { cache: sanitizeLedgerPriceCache(cacheValue), errors: ['Hourly history is not supported by this provider'], changed: false };
  const cache = sanitizeLedgerPriceCache(cacheValue);
  const entries = { ...cache.entries };
  const errors: string[] = [];
  let changed = false;
  const holdings: Holding[] = ledger.assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, type: asset.type, quantity: 1 }));
  for (const holding of holdings) {
    const entryKey = key(holding.type, holding.symbol);
    const existing = entries[entryKey];
    const configuredStart = `${historyStartDate}T00:00:00.000Z`;
    const startTime = existing?.coveredThrough
      ? new Date(Date.parse(existing.coveredThrough) + HOUR_MS).toISOString()
      : configuredStart;
    if (startTime > endTime) continue;
    const result = await provider.getHourlyPrices([holding], startTime, endTime);
    errors.push(...result.errors);
    const series = result.series.find((item) => item.assetType === holding.type && item.symbol.toUpperCase() === holding.symbol.toUpperCase());
    if (!series) continue;
    const points = sanitizePoints([...(existing?.points ?? []), ...series.points]);
    entries[entryKey] = { assetId: holding.id, symbol: holding.symbol.toUpperCase(), assetType: holding.type, coveredThrough: endTime, points };
    changed = true;
  }
  return { cache: { schemaVersion: 1, entries }, errors, changed };
}

function providerCalendarDate(timestamp: string): string { return calendarDateFromTimestamp(timestamp); }

export function calculateLedgerHistory(
  ledger: PortfolioLedger,
  cacheValue: LedgerPriceCache,
  historyStartDate: string,
  endTime: string,
  historyStartMode: HistoryStartMode = 'auto'
): PortfolioHistoryPoint[] {
  const cache = sanitizeLedgerPriceCache(cacheValue);
  const earliestBuyDate = ledger.events
    .filter((event) => event.eventType === 'buy')
    .map((event) => event.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()[0];
  if (historyStartMode === 'auto' && !earliestBuyDate) return [];
  const effectiveStartDate = historyStartMode === 'manual' ? historyStartDate : earliestBuyDate!;
  const updates = new Map<string, Array<{ assetKey: string; price: number }>>();
  for (const [assetKey, entry] of Object.entries(cache.entries)) {
    for (const point of entry.points) {
      if (point.timestamp > endTime) continue;
      const items = updates.get(point.timestamp) ?? [];
      items.push({ assetKey, price: point.price });
      updates.set(point.timestamp, items);
    }
  }
  for (const event of ledger.events) {
    if (event.date < effectiveStartDate) continue;
    const timestamp = localCalendarEndTimestamp(event.date);
    if (timestamp <= endTime && !updates.has(timestamp)) updates.set(timestamp, []);
  }
  const startTimestamp = localCalendarStartTimestamp(effectiveStartDate);
  if (startTimestamp <= endTime && !updates.has(startTimestamp)) updates.set(startTimestamp, []);
  const latestPrices = new Map<string, number>();
  const result: PortfolioHistoryPoint[] = [];
  for (const timestamp of [...updates.keys()].sort()) {
    for (const update of updates.get(timestamp) ?? []) latestPrices.set(update.assetKey, update.price);
    const date = providerCalendarDate(timestamp);
    if (date < effectiveStartDate) continue;
    const account = replayLedger(ledger, date).state;
    let value = account.cash - account.debt;
    let complete = true;
    for (const position of account.positions) {
      if (position.quantity <= 0) continue;
      const price = latestPrices.get(key(position.asset.type, position.asset.symbol));
      if (price === undefined) { complete = false; break; }
      value += position.quantity * price;
    }
    if (complete && Number.isFinite(value)) result.push({ date: timestamp, value });
  }
  return [...new Map(result.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function liveLedgerValue(ledger: PortfolioLedger, quotes: Quote[]): number {
  const account = replayLedger(ledger).state;
  const prices = new Map(quotes.map((quote) => [key(quote.assetType, quote.symbol), quote.price]));
  return account.positions.reduce((total, position) => total + position.quantity * (prices.get(key(position.asset.type, position.asset.symbol)) ?? 0), account.cash - account.debt);
}
