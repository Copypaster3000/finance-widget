import { describe, expect, it } from 'vitest';
import { calendarDateAsLocalDate, calendarDateInTimeZone, isCalendarDate, shiftCalendarDate } from './calendar';

describe('portfolio calendar dates', () => {
  it('keeps a user-entered calendar date independent of UTC parsing', () => {
    const date = calendarDateAsLocalDate('2026-08-29');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(29);
  });

  it('uses the Pacific calendar day across the UTC boundary', () => {
    expect(calendarDateInTimeZone('2026-08-30T02:30:00.000Z', 'America/Los_Angeles')).toBe('2026-08-29');
    expect(calendarDateInTimeZone('2026-08-30T08:30:00.000Z', 'America/Los_Angeles')).toBe('2026-08-30');
  });

  it('keeps a history endpoint on the same Pacific day as its ledger date', () => {
    const ledgerDate = '2026-08-29';
    expect(calendarDateInTimeZone('2026-08-30T02:30:00.000Z', 'America/Los_Angeles')).toBe(ledgerDate);
  });

  it('shifts calendar dates without timezone drift', () => {
    expect(shiftCalendarDate('2026-08-29', 1)).toBe('2026-08-30');
    expect(shiftCalendarDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });
});
