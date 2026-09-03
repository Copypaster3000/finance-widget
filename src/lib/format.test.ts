import { describe, expect, it } from 'vitest';
import { money, normalizedCurrencyValue, signedMoney } from './format';

describe('currency formatting', () => {
  it('normalizes negative zero and sub-cent values', () => {
    expect(money.format(-0)).toBe('$0.00');
    expect(money.format(-0.004)).toBe('$0.00');
    expect(signedMoney(-0.004)).toBe('+$0.00');
    expect(normalizedCurrencyValue(-0.004)).toBe(0);
  });

  it('preserves meaningful negative values', () => {
    expect(money.format(-0.01)).toBe('-$0.01');
    expect(signedMoney(-0.01)).toBe('−$0.01');
  });
});
