import { DEFAULT_CONFIG } from './defaults';
import type { AppConfig, HistoryRange, Holding, RefreshMode, StockSession } from './types';

export function normalizeRefreshMode(value: unknown): RefreshMode {
  if (value === 'manual' || value === '1h' || value === '15m' || value === '15s') return value;
  if (value === 'live') return '15s';
  if (value === '5m' || value === '1m') return '15m';
  return 'manual';
}

export function normalizeAppearanceScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.min(1.4, Math.max(0.8, numeric)) * 10) / 10;
}

export function normalizeStockSession(value: unknown): StockSession {
  return value === 'regular' ? 'regular' : 'extended';
}

export function normalizeHistoryRange(value: unknown): HistoryRange {
  return value === '1h' || value === '1d' || value === '1w' || value === '1m' ? value : 'all';
}

export function addHolding(holdings: Holding[], holding: Holding): Holding[] {
  return [...holdings, holding];
}

export function editHolding(holdings: Holding[], id: string, update: Partial<Omit<Holding, 'id'>>): Holding[] {
  return holdings.map((holding) => holding.id === id ? { ...holding, ...update } : holding);
}

export function removeHolding(holdings: Holding[], id: string): Holding[] {
  return holdings.filter((holding) => holding.id !== id);
}

export function serializeConfig(config: AppConfig): string {
  return JSON.stringify(config);
}

export function deserializeConfig(value: string): AppConfig {
  const parsed = JSON.parse(value) as Partial<Omit<AppConfig, 'schemaVersion'>> & { schemaVersion?: number } & Record<string, unknown>;
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(parsed.schemaVersion ?? 0)) throw new Error('Unsupported configuration schema');
  delete parsed.provider;
  delete parsed.twelveDataApiKey;
  delete parsed.fmpApiKey;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    appearance: {
      ...DEFAULT_CONFIG.appearance,
      ...parsed.appearance,
      scale: normalizeAppearanceScale(parsed.appearance?.scale),
      historyRange: normalizeHistoryRange(parsed.appearance?.historyRange),
      showCash: typeof parsed.appearance?.showCash === 'boolean' ? parsed.appearance.showCash : (parsed.schemaVersion ?? 0) <= 8,
      showDebt: typeof parsed.appearance?.showDebt === 'boolean' ? parsed.appearance.showDebt : (parsed.schemaVersion ?? 0) <= 8
    },
    refreshMode: normalizeRefreshMode(parsed.refreshMode),
    stockSession: normalizeStockSession(parsed.stockSession),
    historyStartDate: typeof parsed.historyStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.historyStartDate)
      ? parsed.historyStartDate
      : DEFAULT_CONFIG.historyStartDate,
    historyStartMode: parsed.historyStartMode === 'manual' ? 'manual' : 'auto',
    showInTaskbar: typeof parsed.showInTaskbar === 'boolean' ? parsed.showInTaskbar : DEFAULT_CONFIG.showInTaskbar,
    schemaVersion: 10
  };
}
