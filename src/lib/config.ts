import { isCalendarDate } from './calendar';
import { DEFAULT_CONFIG } from './defaults';
import type { AppConfig, HistoryRange, RefreshMode, StockSession } from './types';

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

export function normalizeConfig(raw: unknown): AppConfig {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('INTEGRITY_ERROR: Invalid configuration.');
  const value = raw as (Partial<Omit<AppConfig, 'schemaVersion'>> & { schemaVersion?: number }) | null | undefined;
  if (value != null && (typeof value !== 'object' || !Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1)) throw new Error('INTEGRITY_ERROR: Invalid configuration schema.');
  if (value && Number(value.schemaVersion) > 10) throw new Error('UNSUPPORTED_SCHEMA: Update Finance Widget to open this configuration.');
  if (value?.historyStartDate !== undefined && !isCalendarDate(value.historyStartDate)) throw new Error('INTEGRITY_ERROR: Invalid history start date.');
  const current = { ...value } as Partial<AppConfig> & Record<string, unknown>;
  delete current.provider;
  delete current.twelveDataApiKey;
  delete current.fmpApiKey;
  return {
    ...DEFAULT_CONFIG,
    ...current,
    appearance: {
      ...DEFAULT_CONFIG.appearance,
      ...current.appearance,
      scale: normalizeAppearanceScale(current.appearance?.scale),
      historyRange: normalizeHistoryRange(current.appearance?.historyRange),
      showCash: typeof current.appearance?.showCash === 'boolean' ? current.appearance.showCash : typeof current.schemaVersion === 'number' && current.schemaVersion <= 8,
      showDebt: typeof current.appearance?.showDebt === 'boolean' ? current.appearance.showDebt : typeof current.schemaVersion === 'number' && current.schemaVersion <= 8
    },
    refreshMode: normalizeRefreshMode(current.refreshMode),
    stockSession: normalizeStockSession(current.stockSession),
    historyStartDate: typeof current.historyStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(current.historyStartDate)
      ? current.historyStartDate
      : DEFAULT_CONFIG.historyStartDate,
    historyStartMode: current.historyStartMode === 'manual' ? 'manual' : 'auto',
    showInTaskbar: typeof current.showInTaskbar === 'boolean' ? current.showInTaskbar : DEFAULT_CONFIG.showInTaskbar,
    schemaVersion: 10
  };
}
