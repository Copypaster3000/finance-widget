import type { Holding, LedgerAccountState, PortfolioSummary, Position, Quote } from './types';

export function normalizeQuantity(value: unknown): number {
  const quantity = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}

export function calculatePortfolio(holdings: Holding[], quotes: Quote[]): PortfolioSummary {
  const quoteMap = new Map(quotes.map((quote) => [`${quote.assetType}:${quote.symbol.toUpperCase()}`, quote]));
  const positions = holdings.map((holding) => {
    const quantity = normalizeQuantity(holding.quantity);
    const quote = quoteMap.get(`${holding.type}:${holding.symbol.toUpperCase()}`);
    const value = quote && Number.isFinite(quote.price) ? quantity * quote.price : 0;
    const dailyChangeValue = quote?.previousClose != null ? quantity * (quote.price - quote.previousClose) : undefined;
    return { ...holding, quantity, quote, value, allocation: 0, dailyChangeValue };
  });

  const totalValue = positions.reduce((total, position) => total + position.value, 0);
  for (const position of positions) position.allocation = totalValue > 0 ? (position.value / totalValue) * 100 : 0;
  positions.sort((left, right) => right.value - left.value);

  const changes = positions.map((position) => position.dailyChangeValue).filter((value): value is number => value != null);
  const dailyChangeValue = changes.length ? changes.reduce((total, value) => total + value, 0) : undefined;
  const priorValue = dailyChangeValue == null ? undefined : totalValue - dailyChangeValue;
  const dailyChangePercent = priorValue && priorValue > 0 && dailyChangeValue != null ? (dailyChangeValue / priorValue) * 100 : undefined;

  return { positions, totalValue, grossAssets: totalValue, cash: 0, debt: 0, dailyChangeValue, dailyChangePercent, investmentPositionCount: positions.length };
}

export function calculateLedgerPortfolio(account: LedgerAccountState, quotes: Quote[]): PortfolioSummary {
  const quoteMap = new Map(quotes.map((quote) => [`${quote.assetType}:${quote.symbol.toUpperCase()}`, quote]));
  const positions: Position[] = account.positions.map((state) => {
    const quote = quoteMap.get(`${state.asset.type}:${state.asset.symbol.toUpperCase()}`);
    const value = quote && Number.isFinite(quote.price) ? state.quantity * quote.price : 0;
    const dailyChangeValue = quote?.previousClose != null ? state.quantity * (quote.price - quote.previousClose) : undefined;
    return { id: state.asset.id, symbol: state.asset.symbol, type: state.asset.type, quantity: state.quantity, quote, value, allocation: 0, dailyChangeValue };
  });
  positions.push({ id: 'cash', symbol: 'CASH', type: 'cash', quantity: account.cash, value: account.cash, allocation: 0 });
  positions.push({ id: 'debt', symbol: 'MARGIN DEBT', type: 'debt', quantity: account.debt, value: -account.debt, allocation: 0 });

  const grossAssets = positions.filter((position) => position.type !== 'debt').reduce((total, position) => total + Math.max(0, position.value), 0);
  const totalValue = grossAssets - account.debt;
  for (const position of positions) position.allocation = grossAssets > 0 ? (Math.abs(position.value) / grossAssets) * 100 : 0;
  positions.sort((left, right) => right.value - left.value);

  const changes = positions.map((position) => position.dailyChangeValue).filter((value): value is number => value != null);
  const dailyChangeValue = changes.length ? changes.reduce((total, value) => total + value, 0) : undefined;
  const priorValue = dailyChangeValue == null ? undefined : totalValue - dailyChangeValue;
  const dailyChangePercent = priorValue && priorValue !== 0 && dailyChangeValue != null ? (dailyChangeValue / priorValue) * 100 : undefined;
  return { positions, totalValue, grossAssets, cash: account.cash, debt: account.debt, dailyChangeValue, dailyChangePercent, investmentPositionCount: account.positions.filter((position) => position.quantity > 0).length };
}

export function isQuoteUsable(value: unknown): value is Pick<Quote, 'price'> {
  if (!value || typeof value !== 'object') return false;
  const price = (value as { price?: unknown }).price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

export function isQuoteStale(quote: Quote, now = Date.now(), maxAgeMs = 15 * 60_000): boolean {
  return now - quote.timestamp > maxAgeMs;
}
