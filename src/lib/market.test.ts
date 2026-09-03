import { describe, expect, it } from 'vitest';
import { isUsEquityExtendedSessionOpen, isUsEquityMarketOpen } from './market';

describe('US equity market hours', () => {
  it('opens at 9:30 and closes at 16:00 Eastern', () => {
    expect(isUsEquityMarketOpen(Date.parse('2026-08-24T13:29:00Z'))).toBe(false);
    expect(isUsEquityMarketOpen(Date.parse('2026-08-24T13:30:00Z'))).toBe(true);
    expect(isUsEquityMarketOpen(Date.parse('2026-08-24T19:59:00Z'))).toBe(true);
    expect(isUsEquityMarketOpen(Date.parse('2026-08-24T20:00:00Z'))).toBe(false);
  });

  it('stays closed on weekends', () => {
    expect(isUsEquityMarketOpen(Date.parse('2026-08-23T16:00:00Z'))).toBe(false);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-23T23:59:00Z'))).toBe(false);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-24T00:00:00Z'))).toBe(true);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-22T16:00:00Z'))).toBe(false);
  });

  it('polls throughout the extended trading week until Friday 20:00 Eastern', () => {
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-24T07:59:00Z'))).toBe(true);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-25T00:00:00Z'))).toBe(true);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-28T23:59:00Z'))).toBe(true);
    expect(isUsEquityExtendedSessionOpen(Date.parse('2026-08-29T00:00:00Z'))).toBe(false);
  });
});
