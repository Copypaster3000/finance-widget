const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localCalendarDate(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDateInTimeZone(timestamp: number | string, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function calendarDateFromTimestamp(timestamp: number | string): string {
  return localCalendarDate(new Date(timestamp).getTime());
}

export function shiftCalendarDate(value: string, days: number): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function localCalendarEndTimestamp(value: string): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 0, 0).toISOString();
}

export function localCalendarStartTimestamp(value: string): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

export function calendarDateAsLocalDate(value: string): Date {
  if (!isCalendarDate(value)) return new Date(Number.NaN);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
