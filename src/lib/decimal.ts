export const QUANTITY_DIGITS = 8;
export const PRICE_DIGITS = 6;
export const MONEY_DIGITS = 2;

export function parseFixed(value: unknown, digits: number, allowNegative = false): bigint | undefined {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const pattern = allowNegative ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(text)) return undefined;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > digits) return undefined;
  const scale = 10n ** BigInt(digits);
  const result = BigInt(whole) * scale + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
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
  return Number(value) / 10 ** digits;
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
