import type { AppConfig } from './types';
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
