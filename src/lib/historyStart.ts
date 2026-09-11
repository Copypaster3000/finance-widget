import type { AppConfig, PortfolioLedger } from './types';

export function earliestBuyDate(ledger: PortfolioLedger): string | undefined {
  return ledger.events.filter(event => event.eventType === 'buy').map(event => event.date).sort()[0];
}

export function resolveHistoryStart(config: Pick<AppConfig, 'historyStartMode' | 'historyStartDate'>, ledger: PortfolioLedger): string {
  return config.historyStartMode === 'manual' ? config.historyStartDate : earliestBuyDate(ledger) ?? config.historyStartDate;
}
