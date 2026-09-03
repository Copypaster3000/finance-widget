import type { AppConfig, Quote } from './types';
import { localCalendarDate } from './calendar';

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: 10,
  refreshMode: 'manual',
  appearance: {
    opacity: 0.86,
    scale: 1,
    accent: 'amber',
    showHistory: true,
    showQuantity: true,
    showPrice: true,
    showDailyChange: true,
    showCash: false,
    showDebt: false,
    historyRange: 'all'
  },
  windowMode: 'normal',
  launchAtStartup: false,
  showInTaskbar: false,
  stockSession: 'extended',
  historyStartDate: localCalendarDate(),
  historyStartMode: 'auto'
};

export const MOCK_QUOTES: Quote[] = [
  { symbol: 'ETH', assetType: 'crypto', price: 2500, currency: 'USD', previousClose: 2475, change: 25, changePercent: 1.01, timestamp: Date.now(), provider: 'Demo feed', status: 'mock' },
  { symbol: 'MSFT', assetType: 'stock', price: 420, currency: 'USD', previousClose: 415, change: 5, changePercent: 1.2, timestamp: Date.now(), provider: 'Demo feed', status: 'mock' },
  { symbol: 'SPY', assetType: 'stock', price: 600, currency: 'USD', previousClose: 603, change: -3, changePercent: -0.5, timestamp: Date.now(), provider: 'Demo feed', status: 'mock' }
];
