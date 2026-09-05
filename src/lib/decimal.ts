export const QUANTITY_DIGITS = 8;
export const PRICE_DIGITS = 6;
export const MONEY_DIGITS = 2;
export const MAX_MONEY = 1_000_000_000_000;
export const MAX_QUANTITY = 1_000_000;
export const MAX_PRICE = 1_000_000;
export function fixedLimit(digits: number): bigint { return BigInt(digits === MONEY_DIGITS ? MAX_MONEY : MAX_QUANTITY) * 10n ** BigInt(digits); }
export function safeNumber(value: number, limit = MAX_MONEY): number {
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw new Error('Value exceeds the supported numeric range.');
  return value;
}

export function parseFixed(value: unknown, digits: number, allowNegative = false): bigint | undefined {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const text = raw.replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`);
  if (text.length > 40) return undefined;
  const pattern = allowNegative ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(text)) return undefined;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > digits) return undefined;
  const scale = 10n ** BigInt(digits);
  const result = BigInt(whole) * scale + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
  if (result > fixedLimit(digits)) return undefined;
  return negative ? -result : result;
}

export function formatFixed(value: bigint, digits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function fixedToNumber(value: bigint, digits: number): number {
  if (value > fixedLimit(digits) || value < -fixedLimit(digits)) throw new Error('Value exceeds the supported numeric range.');
  return safeNumber(Number(value) / 10 ** digits, digits === MONEY_DIGITS ? MAX_MONEY : MAX_QUANTITY);
}

export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Invalid fixed-point denominator');
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

export function canonicalDecimal(value: unknown, digits: number, allowNegative = false): string | undefined {
  const parsed = parseFixed(value, digits, allowNegative);
  return parsed === undefined ? undefined : formatFixed(parsed, digits);
}
