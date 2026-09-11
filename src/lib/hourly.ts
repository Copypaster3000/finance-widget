import { MAX_MONEY, MAX_PRICE } from './decimal';
import type { HistoryRange, HourlyPricePoint, PortfolioDayChange, PortfolioHistoryPoint, PortfolioHourlyCache } from './types';

const HOUR_MS = 3_600_000;
const RANGE_MS: Partial<Record<HistoryRange, number>> = {
  '1h': HOUR_MS,
  '1d': 24 * HOUR_MS,
  '1w': 7 * 24 * HOUR_MS,
  '1m': 30 * 24 * HOUR_MS
};

export const HISTORY_RANGE_LABELS: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: '1h', label: '1HR' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: 'all', label: 'MAX' }
];

export const EMPTY_HOURLY_CACHE: PortfolioHourlyCache = {
  schemaVersion: 2,
  coveredThrough: '',
  points: [],
  recentPoints: [],
  assetPrices: {}
};

export function hourTimestamp(value: string | number | Date): string {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function completedHour(now = Date.now()): string {
  return new Date(Math.floor(now / HOUR_MS) * HOUR_MS - HOUR_MS).toISOString();
}

function validHourlyPoint(value: unknown): value is HourlyPricePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<HourlyPricePoint>;
  return typeof point.timestamp === 'string' && Number.isFinite(Date.parse(point.timestamp)) &&
    typeof point.price === 'number' && Number.isFinite(point.price) && point.price > 0 && point.price <= MAX_PRICE;
}

function sanitizeValuePoints(points: unknown): PortfolioHistoryPoint[] {
  if (!Array.isArray(points)) return [];
  const valid = points.filter((point): point is PortfolioHistoryPoint => {
    if (!point || typeof point !== 'object') return false;
    const candidate = point as Partial<PortfolioHistoryPoint>;
    return typeof candidate.date === 'string' && Number.isFinite(Date.parse(candidate.date)) &&
      typeof candidate.value === 'number' && Number.isFinite(candidate.value) && Math.abs(candidate.value) <= MAX_MONEY;
  });
  return [...new Map(valid.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function sanitizeHourlyCache(value: Partial<PortfolioHourlyCache> | null | undefined): PortfolioHourlyCache {
  const assetPrices = Object.fromEntries(Object.entries(value?.assetPrices ?? {}).filter((entry): entry is [string, HourlyPricePoint] => validHourlyPoint(entry[1])));
  const coveredThrough = typeof value?.coveredThrough === 'string' && Number.isFinite(Date.parse(value.coveredThrough)) ? hourTimestamp(value.coveredThrough) : '';
  return {
    schemaVersion: 2,
    coveredThrough,
    points: sanitizeValuePoints(value?.points),
    recentPoints: sanitizeValuePoints(value?.recentPoints),
    assetPrices
  };
}

export function recordRecentPortfolio(
  cacheValue: PortfolioHourlyCache,
  value: number,
  now = Date.now()
): PortfolioHourlyCache {
  const cache = sanitizeHourlyCache(cacheValue);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MONEY) return cache;
  const cutoff = now - HOUR_MS;
  const recentPoints = sanitizeValuePoints([
    ...cache.recentPoints.filter((point) => Date.parse(point.date) >= cutoff),
    { date: new Date(now).toISOString(), value }
  ]);
  return { ...cache, recentPoints };
}

export function availableHistoryRanges(cacheValue: PortfolioHourlyCache, now = Date.now()): HistoryRange[] {
  const points = sanitizeHourlyCache(cacheValue).points;
  const oldest = points[0] ? Date.parse(points[0].date) : now;
  const span = Math.max(0, now - oldest);
  return HISTORY_RANGE_LABELS
    .filter(({ value }) => value === '1h' || value === 'all' || span >= (RANGE_MS[value] ?? Infinity))
    .map(({ value }) => value);
}

export function chartHistory(
  cacheValue: PortfolioHourlyCache,
  liveValue: number,
  now = Date.now(),
  maxPoints = 480,
  range: HistoryRange = 'all'
): PortfolioHistoryPoint[] {
  const cache = sanitizeHourlyCache(cacheValue);
  const storedPoints = range === '1h' ? [...cache.points, ...cache.recentPoints] : cache.points;
  const allPoints = sanitizeValuePoints(Number.isFinite(liveValue)
    ? [...storedPoints, { date: new Date(now).toISOString(), value: liveValue }]
    : storedPoints);
  const duration = RANGE_MS[range];
  let points = allPoints;
  if (duration !== undefined && allPoints.length) {
    const cutoff = now - duration;
    points = allPoints.filter((point) => Date.parse(point.date) >= cutoff);
    const prior = allPoints.filter((point) => Date.parse(point.date) < cutoff).at(-1);
    if (prior) points = [{ date: new Date(cutoff).toISOString(), value: prior.value }, ...points];
  }
  if (points.length <= maxPoints) return points;
  const sampled: PortfolioHistoryPoint[] = [];
  const last = points.length - 1;
  for (let index = 0; index < maxPoints; index += 1) sampled.push(points[Math.round((index / (maxPoints - 1)) * last)]);
  return [...new Map(sampled.map((point) => [point.date, point])).values()];
}

export function portfolioChangeSinceLocalMidnight(
  pointsValue: PortfolioHistoryPoint[],
  liveValue: number,
  now = Date.now()
): PortfolioDayChange | undefined {
  if (!Number.isFinite(liveValue) || liveValue <= 0) return undefined;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const midnightTime = midnight.getTime();
  const baseline = sanitizeValuePoints(pointsValue).filter((point) => Date.parse(point.date) <= midnightTime).at(-1);
  if (!baseline || baseline.value <= 0) return undefined;
  const value = liveValue - baseline.value;
  return {
    baselineAt: baseline.date,
    baselineValue: baseline.value,
    value,
    percent: (value / baseline.value) * 100
  };
}
