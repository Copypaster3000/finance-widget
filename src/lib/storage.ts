import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, HistoricalCache, Holding, LedgerPriceCache, PortfolioHourlyCache, PortfolioLedger, Quote } from './types';
import { DEFAULT_CONFIG } from './defaults';
import { EMPTY_HOURLY_CACHE, sanitizeHourlyCache } from './hourly';
import { normalizeAppearanceScale, normalizeHistoryRange, normalizeRefreshMode, normalizeStockSession } from './config';
import { migrateLegacyHoldings, sanitizeLedger } from './ledger';
import { EMPTY_LEDGER_PRICE_CACHE, sanitizeLedgerPriceCache } from './ledgerHistory';

const CONFIG_KEY = 'configuration';
const QUOTES_KEY = 'quote-cache';
const HISTORY_KEY = 'history-cache-v1';
const HOURLY_HISTORY_KEY = 'portfolio-hourly-history-v1';
const LEDGER_KEY = 'portfolio-ledger-v1';
const LEDGER_PRICE_HISTORY_KEY = 'ledger-price-history-v1';
let writeQueue: Promise<void> = Promise.resolve();
const RETRY_DELAYS = [0, 75, 250, 750] as const;

export class StorageUnavailableError extends Error {
  constructor(detail = 'LOCAL DATA STORE UNAVAILABLE') {
    super(detail);
    this.name = 'StorageUnavailableError';
  }
}

function mergeConfig(value: Partial<AppConfig> | null | undefined): AppConfig {
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

function wait(delay: number): Promise<void> {
  return delay > 0 ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve();
}

async function loadNativeData(): Promise<Record<string, unknown>> {
  let failure = 'LOCAL DATA STORE UNAVAILABLE';
  for (const delay of RETRY_DELAYS) {
    await wait(delay);
    try {
      return await invoke<Record<string, unknown>>('load_portfolio');
    } catch (error) {
      failure = String(error);
    }
  }
  throw new StorageUnavailableError(failure);
}

function enqueueNativeWrite(updates: Record<string, unknown>): Promise<void> {
  const queued = writeQueue.then(() => invoke<void>('save_portfolio', { updates }));
  writeQueue = queued.catch(() => undefined);
  return queued;
}

function hasNativeBridge(): boolean {
  return import.meta.env.MODE === 'desktop' || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
}

function loadBrowserState(): ReturnType<typeof readStoredState> {
  const rawConfig = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') as (Partial<AppConfig> & { holdings?: Holding[] }) | null;
  return readStoredState({
    rawConfig,
    quotes: JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]') as Quote[],
    historyCache: JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') as HistoricalCache,
    hourlyHistory: JSON.parse(localStorage.getItem(HOURLY_HISTORY_KEY) || JSON.stringify(EMPTY_HOURLY_CACHE)) as PortfolioHourlyCache,
    rawLedger: JSON.parse(localStorage.getItem(LEDGER_KEY) || 'null') as PortfolioLedger | null,
    ledgerPriceCache: JSON.parse(localStorage.getItem(LEDGER_PRICE_HISTORY_KEY) || JSON.stringify(EMPTY_LEDGER_PRICE_CACHE)) as LedgerPriceCache
  });
}

function readStoredState(values: {
  rawConfig: (Partial<AppConfig> & { holdings?: Holding[] } & Record<string, unknown>) | null | undefined;
  quotes: Quote[] | null | undefined;
  historyCache: HistoricalCache | null | undefined;
  hourlyHistory: PortfolioHourlyCache | null | undefined;
  rawLedger: PortfolioLedger | null | undefined;
  ledgerPriceCache: LedgerPriceCache | null | undefined;
}) {
  const config = mergeConfig(values.rawConfig);
  const storedLedger = sanitizeLedger(values.rawLedger);
  const ledger = storedLedger ?? migrateLegacyHoldings(Array.isArray(values.rawConfig?.holdings) ? values.rawConfig.holdings : [], config.historyStartDate);
  return {
    config,
    quotes: values.quotes ?? [],
    historyCache: values.historyCache ?? {},
    hourlyHistory: sanitizeHourlyCache(values.hourlyHistory),
    ledger,
    ledgerPriceCache: sanitizeLedgerPriceCache(values.ledgerPriceCache),
    ledgerMigrated: !storedLedger || values.rawLedger?.schemaVersion !== 2,
    configMigrated: values.rawConfig?.schemaVersion !== 10
  };
}

export async function loadState(): Promise<{ config: AppConfig; quotes: Quote[]; historyCache: HistoricalCache; hourlyHistory: PortfolioHourlyCache; ledger: PortfolioLedger; ledgerPriceCache: LedgerPriceCache; ledgerMigrated: boolean; configMigrated: boolean }> {
  if (hasNativeBridge()) {
    const data = await loadNativeData();
    return readStoredState({
      rawConfig: data[CONFIG_KEY] as Partial<AppConfig> & { holdings?: Holding[] },
      quotes: data[QUOTES_KEY] as Quote[], historyCache: data[HISTORY_KEY] as HistoricalCache,
      hourlyHistory: data[HOURLY_HISTORY_KEY] as PortfolioHourlyCache,
      rawLedger: data[LEDGER_KEY] as PortfolioLedger, ledgerPriceCache: data[LEDGER_PRICE_HISTORY_KEY] as LedgerPriceCache
    });
  }
  return loadBrowserState();
}

export async function saveLedgerPriceCache(cache: LedgerPriceCache): Promise<void> {
  const sanitized = sanitizeLedgerPriceCache(cache);
  if (!hasNativeBridge()) return localStorage.setItem(LEDGER_PRICE_HISTORY_KEY, JSON.stringify(sanitized));
  return enqueueNativeWrite({ [LEDGER_PRICE_HISTORY_KEY]: sanitized });
}

export async function saveLedger(ledger: PortfolioLedger): Promise<void> {
  if (!hasNativeBridge()) return localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  return enqueueNativeWrite({ [LEDGER_KEY]: ledger });
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (!hasNativeBridge()) return localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  return enqueueNativeWrite({ [CONFIG_KEY]: config });
}

export async function saveQuotes(quotes: Quote[]): Promise<void> {
  if (!hasNativeBridge()) return localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  return enqueueNativeWrite({ [QUOTES_KEY]: quotes });
}

export async function saveHistoryCache(historyCache: HistoricalCache): Promise<void> {
  if (!hasNativeBridge()) return localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  return enqueueNativeWrite({ [HISTORY_KEY]: historyCache });
}

export async function saveHourlyHistory(hourlyHistory: PortfolioHourlyCache): Promise<void> {
  const sanitized = sanitizeHourlyCache(hourlyHistory);
  if (!hasNativeBridge()) return localStorage.setItem(HOURLY_HISTORY_KEY, JSON.stringify(sanitized));
  return enqueueNativeWrite({ [HOURLY_HISTORY_KEY]: sanitized });
}

export async function saveLedgerState(ledger: PortfolioLedger, config: AppConfig, hourly: PortfolioHourlyCache, prices: LedgerPriceCache): Promise<void> {
  if (!hasNativeBridge()) { await Promise.all([saveLedger(ledger), saveConfig(config), saveHourlyHistory(hourly), saveLedgerPriceCache(prices)]); return; }
  return enqueueNativeWrite({ [LEDGER_KEY]: ledger, [CONFIG_KEY]: config, [HOURLY_HISTORY_KEY]: sanitizeHourlyCache(hourly), [LEDGER_PRICE_HISTORY_KEY]: sanitizeLedgerPriceCache(prices) });
}
