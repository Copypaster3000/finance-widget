import { describe, expect, it } from 'vitest';
import { calendarDateAsLocalDate, calendarDateFromTimestamp, isCalendarDate, shiftCalendarDate } from './calendar';

describe('portfolio calendar dates', () => {
  it('keeps a user-entered calendar date independent of UTC parsing', () => {
    const date = calendarDateAsLocalDate('2026-08-29');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(29);
  });

  it('round-trips the active local date and timestamp helpers', () => {
    expect(calendarDateFromTimestamp(new Date(2020, 0, 2, 12).toISOString())).toBe('2020-01-02');
  });

  it('shifts calendar dates without timezone drift', () => {
    expect(shiftCalendarDate('2026-08-29', 1)).toBe('2026-08-30');
    expect(shiftCalendarDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });
});
