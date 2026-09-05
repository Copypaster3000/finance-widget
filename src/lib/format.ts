import { MAX_MONEY, MAX_QUANTITY } from './decimal';

const moneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactMoneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export function normalizedCurrencyValue(value: number): number {
  return Number.isFinite(value) && Math.abs(value) < 0.005 ? 0 : value;
}

export const money = { format: (value: number) => Number.isFinite(value) && Math.abs(value) <= MAX_MONEY ? moneyFormatter.format(normalizedCurrencyValue(value)) : 'UNAVAILABLE' };
export const compactMoney = { format: (value: number) => Number.isFinite(value) && Math.abs(value) <= MAX_MONEY ? compactMoneyFormatter.format(normalizedCurrencyValue(value)) : 'UNAVAILABLE' };

export function formatQuantity(value: number, type: 'stock' | 'crypto'): string {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_QUANTITY) return 'UNAVAILABLE';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: type === 'crypto' ? 8 : 4 }).format(value);
}

export function signedMoney(value: number): string {
  const normalized = normalizedCurrencyValue(value);
  const absolute = money.format(Math.abs(normalized));
  return `${normalized >= 0 ? '+' : '−'}${absolute}`;
}

export function signedPercent(value: number): string {
  if (!Number.isFinite(value)) return 'UNAVAILABLE';
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized >= 0 ? '+' : '−'}${Math.abs(normalized).toFixed(2)}%`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'NOW';
  if (seconds < 60) return `${seconds}S AGO`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}H AGO` : `${Math.floor(hours / 24)}D AGO`;
}

export function syncTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(new Date(timestamp));
}
