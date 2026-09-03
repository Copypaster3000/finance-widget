import { normalizeQuantity } from './portfolio';
import { isCalendarDate, shiftCalendarDate } from './calendar';
import type {
  HistoricalCache,
  HistoricalCacheEntry,
  HistoricalPricePoint,
  HistoricalSeries,
  Holding,
  PortfolioHistoryPoint,
  PriceProvider,
  ProviderKind,
  Quote
} from './types';

const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  return isCalendarDate(value);
}

export function shiftDate(date: string, days: number): string {
  return shiftCalendarDate(date, days);
}

export function datesBetween(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return [];
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

export function utcDate(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function historyKey(provider: ProviderKind, type: Holding['type'], symbol: string): string {
  return `${provider}:${type}:${symbol.trim().toUpperCase()}`;
}

function seriesKey(type: Holding['type'], symbol: string): string {
  return `${type}:${symbol.trim().toUpperCase()}`;
}

function sanitizePoints(points: unknown): HistoricalPricePoint[] {
  if (!Array.isArray(points)) return [];
  const valid = points.filter((point): point is HistoricalPricePoint => {
    if (!point || typeof point !== 'object') return false;
    const candidate = point as Partial<HistoricalPricePoint>;
    return isIsoDate(candidate.date) && typeof candidate.price === 'number' && Number.isFinite(candidate.price) && candidate.price > 0;
  });
  return [...new Map(valid.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sanitizeEntry(value: HistoricalCacheEntry | undefined, provider: ProviderKind, holding: Holding): HistoricalCacheEntry | undefined {
  if (!value || value.provider !== provider || value.assetType !== holding.type || value.symbol !== holding.symbol.toUpperCase()) return undefined;
  if (!isIsoDate(value.coveredStart) || !isIsoDate(value.coveredEnd) || value.coveredStart > value.coveredEnd) return undefined;
  return { ...value, points: sanitizePoints(value.points) };
}

export async function syncHistoricalCache(
  provider: PriceProvider,
  providerKind: ProviderKind,
  holdings: Holding[],
  cache: HistoricalCache,
  startDate: string,
  endDate: string
): Promise<{ cache: HistoricalCache; errors: string[]; changed: boolean }> {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return { cache, errors: [], changed: false };
  const next = { ...cache };
  const errors: string[] = [];
  let changed = false;
  const unique = [...new Map(holdings.map((holding) => [seriesKey(holding.type, holding.symbol), { ...holding, symbol: holding.symbol.toUpperCase() }])).values()];

  for (const holding of unique) {
    const key = historyKey(providerKind, holding.type, holding.symbol);
    let entry = sanitizeEntry(next[key], providerKind, holding);
    const ranges: Array<[string, string]> = [];
    if (!entry) ranges.push([startDate, endDate]);
    else {
      if (startDate < entry.coveredStart) ranges.push([startDate, shiftDate(entry.coveredStart, -1)]);
      if (endDate > entry.coveredEnd) ranges.push([shiftDate(entry.coveredEnd, 1), endDate]);
    }

    for (const [rangeStart, rangeEnd] of ranges) {
      const result = await provider.getHistoricalPrices([holding], rangeStart, rangeEnd);
      errors.push(...result.errors);
      const series = result.series.find((item) => item.assetType === holding.type && item.symbol.toUpperCase() === holding.symbol);
      if (!series) continue;
      const points = sanitizePoints([...(entry?.points ?? []), ...series.points]);
      entry = {
        provider: providerKind,
        symbol: holding.symbol,
        assetType: holding.type,
        points,
        coveredStart: entry ? (rangeStart < entry.coveredStart ? rangeStart : entry.coveredStart) : rangeStart,
        coveredEnd: entry ? (rangeEnd > entry.coveredEnd ? rangeEnd : entry.coveredEnd) : rangeEnd
      };
      next[key] = entry;
      changed = true;
    }
  }

  return { cache: next, errors, changed };
}

export function cachedSeries(cache: HistoricalCache, provider: ProviderKind, holdings: Holding[]): HistoricalSeries[] {
  const unique = [...new Map(holdings.map((holding) => [seriesKey(holding.type, holding.symbol), holding])).values()];
  return unique.flatMap((holding) => {
    const entry = sanitizeEntry(cache[historyKey(provider, holding.type, holding.symbol)], provider, { ...holding, symbol: holding.symbol.toUpperCase() });
    return entry ? [{ symbol: entry.symbol, assetType: entry.assetType, points: entry.points }] : [];
  });
}

export function calculatePortfolioHistory(
  holdings: Holding[],
  series: HistoricalSeries[],
  quotes: Quote[],
  startDate: string,
  endDate: string
): PortfolioHistoryPoint[] {
  const active = holdings.filter((holding) => normalizeQuantity(holding.quantity) > 0);
  if (!active.length) return [];
  const seriesMap = new Map(series.map((item) => [seriesKey(item.assetType, item.symbol), new Map(sanitizePoints(item.points).map((point) => [point.date, point.price]))]));
  const quoteMap = new Map(quotes.filter((quote) => Number.isFinite(quote.price) && quote.price > 0).map((quote) => [seriesKey(quote.assetType, quote.symbol), quote.price]));
  const lastPrice = new Map<string, number>();
  const result: PortfolioHistoryPoint[] = [];

  for (const date of datesBetween(startDate, endDate)) {
    let value = 0;
    let complete = true;
    for (const holding of active) {
      const key = seriesKey(holding.type, holding.symbol);
      const historical = seriesMap.get(key)?.get(date);
      if (historical != null) lastPrice.set(key, historical);
      const price = date === endDate ? (quoteMap.get(key) ?? lastPrice.get(key)) : lastPrice.get(key);
      if (price == null) { complete = false; break; }
      value += normalizeQuantity(holding.quantity) * price;
    }
    if (complete && Number.isFinite(value)) result.push({ date, value });
  }
  return result;
}

export function calculateHistoryChange(points: PortfolioHistoryPoint[], index = points.length - 1): number {
  const first = points[0]?.value;
  const current = points[index]?.value;
  return first && current != null ? ((current - first) / first) * 100 : 0;
}
