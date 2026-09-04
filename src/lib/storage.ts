import { isTauri } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
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
let store: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const RETRY_DELAYS = [0, 75, 250, 750] as const;

export class StorageUnavailableError extends Error {
  constructor() {
    super('LOCAL DATA STORE UNAVAILABLE');
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

async function getStore(): Promise<Store> {
  store ??= await Store.load('portfolio.json', { autoSave: 300 });
  return store;
}

function wait(delay: number): Promise<void> {
  return delay > 0 ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve();
}

async function withNativeStore<T>(operation: (appStore: Store) => Promise<T>): Promise<T> {
  for (const delay of RETRY_DELAYS) {
    await wait(delay);
    try {
      return await operation(await getStore());
    } catch {
      store = null;
    }
  }
  throw new StorageUnavailableError();
}

function enqueueNativeWrite(operation: (appStore: Store) => Promise<void>): Promise<void> {
  const queued = writeQueue.then(() => withNativeStore(operation));
  writeQueue = queued.catch(() => undefined);
  return queued;
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
  if (isTauri()) {
    return withNativeStore(async (appStore) => {
      const rawConfig = await appStore.get<Partial<AppConfig> & { holdings?: Holding[] } & Record<string, unknown>>(CONFIG_KEY);
      const quotes = (await appStore.get<Quote[]>(QUOTES_KEY)) ?? [];
      const historyCache = (await appStore.get<HistoricalCache>(HISTORY_KEY)) ?? {};
      const hourlyHistory = sanitizeHourlyCache(await appStore.get<PortfolioHourlyCache>(HOURLY_HISTORY_KEY));
      const rawLedger = await appStore.get<PortfolioLedger>(LEDGER_KEY);
      const ledgerPriceCache = sanitizeLedgerPriceCache(await appStore.get<LedgerPriceCache>(LEDGER_PRICE_HISTORY_KEY));
      return readStoredState({ rawConfig, quotes, historyCache, hourlyHistory, rawLedger, ledgerPriceCache });
    });
  }
  return loadBrowserState();
}

export async function saveLedgerPriceCache(cache: LedgerPriceCache): Promise<void> {
  const sanitized = sanitizeLedgerPriceCache(cache);
  if (!isTauri()) return localStorage.setItem(LEDGER_PRICE_HISTORY_KEY, JSON.stringify(sanitized));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(LEDGER_PRICE_HISTORY_KEY, sanitized); await appStore.save(); });
}

export async function saveLedger(ledger: PortfolioLedger): Promise<void> {
  if (!isTauri()) return localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(LEDGER_KEY, ledger); await appStore.save(); });
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (!isTauri()) return localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(CONFIG_KEY, config); await appStore.save(); });
}

export async function saveQuotes(quotes: Quote[]): Promise<void> {
  if (!isTauri()) return localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(QUOTES_KEY, quotes); await appStore.save(); });
}

export async function saveHistoryCache(historyCache: HistoricalCache): Promise<void> {
  if (!isTauri()) return localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(HISTORY_KEY, historyCache); await appStore.save(); });
}

export async function saveHourlyHistory(hourlyHistory: PortfolioHourlyCache): Promise<void> {
  const sanitized = sanitizeHourlyCache(hourlyHistory);
  if (!isTauri()) return localStorage.setItem(HOURLY_HISTORY_KEY, JSON.stringify(sanitized));
  return enqueueNativeWrite(async (appStore) => { await appStore.set(HOURLY_HISTORY_KEY, sanitized); await appStore.save(); });
}
