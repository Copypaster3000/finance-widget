import { canonicalDecimal, divideRounded, fixedLimit, formatFixed, MONEY_DIGITS, parseFixed, PRICE_DIGITS, QUANTITY_DIGITS } from './decimal';
import { isIsoDate } from './history';
import type { BuyEvent, PriceSource, SellEvent } from './types';

type DecimalInput = string | number;

export interface TradeDraft {
  id?: string;
  side: 'buy' | 'sell';
  assetId: string;
  date: string;
  sequence: number;
  quantity: DecimalInput;
  mode: 'unit' | 'total';
  unitPrice?: DecimalInput;
  totalAmount?: DecimalInput;
  fees?: DecimalInput;
  priceSource?: PriceSource;
  affectsCashDebt?: boolean;
  createdAt?: string;
}

export function hasDecimalInput(value: unknown): boolean {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0;
}

export function buildTradeEvent(draft: TradeDraft, today: string, now = new Date().toISOString()): { event?: BuyEvent | SellEvent; error?: string } {
  if (!isIsoDate(draft.date) || draft.date > today) return { error: 'Enter a valid date that is not in the future.' };
  const quantity = parseFixed(draft.quantity, QUANTITY_DIGITS);
  if (quantity === undefined || quantity <= 0n) return { error: 'Quantity must be greater than zero, at most 1,000,000, with up to 8 decimal places. Use decimal notation.' };
  const quantityText = formatFixed(quantity, QUANTITY_DIGITS);
  let total: bigint | undefined;
  let price: bigint | undefined;
  let fees = 0n;
  let source: PriceSource;
  if (draft.mode === 'total') {
    total = parseFixed(draft.totalAmount, MONEY_DIGITS);
    if (total === undefined || (draft.side === 'buy' ? total <= 0n : total < 0n)) return { error: draft.side === 'buy' ? 'Total Paid must be greater than zero.' : 'Total Proceeds must be zero or greater.' };
    price = divideRounded(total * 10n ** BigInt(QUANTITY_DIGITS + PRICE_DIGITS - MONEY_DIGITS), quantity);
    source = draft.priceSource ?? 'manual_total';
  } else {
    price = parseFixed(draft.unitPrice, PRICE_DIGITS);
    fees = parseFixed(draft.fees || '0', MONEY_DIGITS) ?? -1n;
    if (price === undefined || price <= 0n) return { error: 'Price per unit must be greater than zero, up to 1,000,000 USD with at most 6 decimal places.' };
    if (fees < 0n) return { error: 'Fees must be between zero and 1 trillion USD, with at most 2 decimal places.' };
    const gross = divideRounded(quantity * price, 10n ** BigInt(QUANTITY_DIGITS + PRICE_DIGITS - MONEY_DIGITS));
    total = draft.side === 'buy' ? gross + fees : gross - fees;
    if (total < 0n || (draft.side === 'buy' && total === 0n)) return { error: 'Fees cannot exceed the transaction value.' };
    source = draft.priceSource ?? 'manual_unit';
  }
  if (total > fixedLimit(MONEY_DIGITS) || price > fixedLimit(PRICE_DIGITS) || (draft.side === 'buy' && price === 0n)) return { error: 'Transaction exceeds supported range: money up to 1 trillion USD; unit price up to 1,000,000 USD.' };
  const base = {
    id: draft.id ?? crypto.randomUUID(),
    eventType: draft.side,
    assetId: draft.assetId,
    date: draft.date,
    sequence: draft.sequence,
    quantity: quantityText,
    unitPrice: formatFixed(price, PRICE_DIGITS),
    fees: formatFixed(fees, MONEY_DIGITS),
    totalAmount: formatFixed(total, MONEY_DIGITS),
    priceSource: source,
    affectsCashDebt: draft.affectsCashDebt ?? true,
    createdAt: draft.createdAt ?? now,
    updatedAt: now
  };
  return { event: base as BuyEvent | SellEvent };
}

export function effectiveUnitPrice(totalAmount: unknown, quantity: unknown): string | undefined {
  const total = parseFixed(totalAmount, MONEY_DIGITS);
  const units = parseFixed(quantity, QUANTITY_DIGITS);
  if (total === undefined || units === undefined || units <= 0n) return undefined;
  const price = divideRounded(total * 10n ** BigInt(QUANTITY_DIGITS + PRICE_DIGITS - MONEY_DIGITS), units);
  return price <= fixedLimit(PRICE_DIGITS) ? formatFixed(price, PRICE_DIGITS) : undefined;
}

export function normalizedMoney(value: unknown, allowNegative = false): string | undefined {
  return canonicalDecimal(value, MONEY_DIGITS, allowNegative);
}
