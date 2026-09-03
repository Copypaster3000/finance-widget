const easternClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

export function isUsEquityMarketOpen(now = Date.now()): boolean {
  const parts = Object.fromEntries(easternClock.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday ?? '')) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function isUsEquityExtendedSessionOpen(now = Date.now()): boolean {
  const parts = Object.fromEntries(easternClock.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (parts.weekday === 'Sun') return minutes >= 20 * 60;
  if (['Mon', 'Tue', 'Wed', 'Thu'].includes(parts.weekday ?? '')) return true;
  return parts.weekday === 'Fri' && minutes < 20 * 60;
}
