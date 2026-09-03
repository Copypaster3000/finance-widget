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

export async function loadState(): Promise<{ config: AppConfig; quotes: Quote[]; historyCache: HistoricalCache; hourlyHistory: PortfolioHourlyCache; ledger: PortfolioLedger; ledgerPriceCache: LedgerPriceCache; ledgerMigrated: boolean }> {
  try {
    const appStore = await getStore();
    const rawConfig = await appStore.get<Partial<AppConfig> & { holdings?: Holding[] } & Record<string, unknown>>(CONFIG_KEY);
    const config = mergeConfig(rawConfig);
    const quotes = (await appStore.get<Quote[]>(QUOTES_KEY)) ?? [];
    const historyCache = (await appStore.get<HistoricalCache>(HISTORY_KEY)) ?? {};
    const hourlyHistory = sanitizeHourlyCache(await appStore.get<PortfolioHourlyCache>(HOURLY_HISTORY_KEY));
    const rawLedger = await appStore.get<PortfolioLedger>(LEDGER_KEY);
    const storedLedger = sanitizeLedger(rawLedger);
    const ledger = storedLedger ?? migrateLegacyHoldings(Array.isArray(rawConfig?.holdings) ? rawConfig.holdings : [], config.historyStartDate);
    const ledgerPriceCache = sanitizeLedgerPriceCache(await appStore.get<LedgerPriceCache>(LEDGER_PRICE_HISTORY_KEY));
    return { config, quotes, historyCache, hourlyHistory, ledger, ledgerPriceCache, ledgerMigrated: !storedLedger || rawLedger?.schemaVersion !== 2 };
  } catch {
    const rawConfig = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') as (Partial<AppConfig> & { holdings?: Holding[] }) | null;
    const config = mergeConfig(rawConfig);
    const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]') as Quote[];
    const historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') as HistoricalCache;
    const hourlyHistory = sanitizeHourlyCache(JSON.parse(localStorage.getItem(HOURLY_HISTORY_KEY) || JSON.stringify(EMPTY_HOURLY_CACHE)));
    const rawLedger = JSON.parse(localStorage.getItem(LEDGER_KEY) || 'null') as PortfolioLedger | null;
    const storedLedger = sanitizeLedger(rawLedger);
    const ledger = storedLedger ?? migrateLegacyHoldings(Array.isArray(rawConfig?.holdings) ? rawConfig.holdings : [], config.historyStartDate);
    const ledgerPriceCache = sanitizeLedgerPriceCache(JSON.parse(localStorage.getItem(LEDGER_PRICE_HISTORY_KEY) || JSON.stringify(EMPTY_LEDGER_PRICE_CACHE)));
    return { config, quotes, historyCache, hourlyHistory, ledger, ledgerPriceCache, ledgerMigrated: !storedLedger || rawLedger?.schemaVersion !== 2 };
  }
}

export async function saveLedgerPriceCache(cache: LedgerPriceCache): Promise<void> {
  const sanitized = sanitizeLedgerPriceCache(cache);
  try {
    const appStore = await getStore();
    await appStore.set(LEDGER_PRICE_HISTORY_KEY, sanitized);
    await appStore.save();
  } catch {
    localStorage.setItem(LEDGER_PRICE_HISTORY_KEY, JSON.stringify(sanitized));
  }
}

export async function saveLedger(ledger: PortfolioLedger): Promise<void> {
  try {
    const appStore = await getStore();
    await appStore.set(LEDGER_KEY, ledger);
    await appStore.save();
  } catch {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    const appStore = await getStore();
    await appStore.set(CONFIG_KEY, config);
    await appStore.save();
  } catch {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }
}

export async function saveQuotes(quotes: Quote[]): Promise<void> {
  try {
    const appStore = await getStore();
    await appStore.set(QUOTES_KEY, quotes);
    await appStore.save();
  } catch {
    localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  }
}

export async function saveHistoryCache(historyCache: HistoricalCache): Promise<void> {
  try {
    const appStore = await getStore();
    await appStore.set(HISTORY_KEY, historyCache);
    await appStore.save();
  } catch {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  }
}

export async function saveHourlyHistory(hourlyHistory: PortfolioHourlyCache): Promise<void> {
  const sanitized = sanitizeHourlyCache(hourlyHistory);
  try {
    const appStore = await getStore();
    await appStore.set(HOURLY_HISTORY_KEY, sanitized);
    await appStore.save();
  } catch {
    localStorage.setItem(HOURLY_HISTORY_KEY, JSON.stringify(sanitized));
  }
}
