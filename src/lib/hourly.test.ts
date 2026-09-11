import { describe, expect, it } from 'vitest';
import { availableHistoryRanges, chartHistory, EMPTY_HOURLY_CACHE, portfolioChangeSinceLocalMidnight, recordRecentPortfolio, sanitizeHourlyCache } from './hourly';
describe('hourly portfolio snapshots', () => {
  it('adds a temporary live point and bounds chart rendering density', () => {
    const points = Array.from({ length: 600 }, (_, index) => ({ date: new Date(Date.UTC(2026, 7, 17, index)).toISOString(), value: index + 1 }));
    const chart = chartHistory({ ...EMPTY_HOURLY_CACHE, points }, 700, Date.UTC(2026, 8, 20), 120);
    expect(chart).toHaveLength(120);
    expect(chart[0].value).toBe(1);
    expect(chart.at(-1)?.value).toBe(700);
  });

  it('filters chart points to the selected window and carries the prior value to its boundary', () => {
    const now = Date.UTC(2026, 7, 24, 12, 45);
    const points = [
      { date: new Date(now - 2 * 3_600_000).toISOString(), value: 100 },
      { date: new Date(now - 30 * 60_000).toISOString(), value: 105 }
    ];
    const chart = chartHistory({ ...EMPTY_HOURLY_CACHE, points }, 110, now, 480, '1h');
    expect(chart).toEqual([
      { date: new Date(now - 3_600_000).toISOString(), value: 100 },
      points[1],
      { date: new Date(now).toISOString(), value: 110 }
    ]);
  });

  it('retains refresh-rate snapshots for one hour and uses them only in the one-hour chart', () => {
    const now = Date.UTC(2026, 7, 24, 12);
    const cache = {
      ...EMPTY_HOURLY_CACHE,
      points: [{ date: new Date(now - 2 * 3_600_000).toISOString(), value: 90 }],
      recentPoints: [
        { date: new Date(now - 3_700_000).toISOString(), value: 95 },
        { date: new Date(now - 30_000).toISOString(), value: 99 }
      ]
    };
    const recorded = recordRecentPortfolio(cache, 100, now);
    expect(recorded.recentPoints).toEqual([
      { date: new Date(now - 30_000).toISOString(), value: 99 },
      { date: new Date(now).toISOString(), value: 100 }
    ]);
    expect(chartHistory(recorded, 100, now, 480, '1h').some((point) => point.value === 99)).toBe(true);
    expect(chartHistory(recorded, 100, now, 480, 'all').some((point) => point.value === 99)).toBe(false);
  });

  it('migrates the old hourly cache without inventing recent samples', () => {
    const migrated = sanitizeHourlyCache({
      schemaVersion: 1, coveredThrough: '', points: [], assetPrices: {}
    } as unknown as Parameters<typeof sanitizeHourlyCache>[0]);
    expect(migrated).toMatchObject({ schemaVersion: 2, recentPoints: [] });
  });

  it('offers intermediate ranges only when enough history exists', () => {
    const now = Date.UTC(2026, 7, 24, 12);
    const eightDays = { ...EMPTY_HOURLY_CACHE, points: [{ date: new Date(now - 8 * 86_400_000).toISOString(), value: 100 }] };
    expect(availableHistoryRanges(EMPTY_HOURLY_CACHE, now)).toEqual(['1h', 'all']);
    expect(availableHistoryRanges(eightDays, now)).toEqual(['1h', '1d', '1w', 'all']);
  });

  it('calculates the live gain from the latest stored value at local midnight', () => {
    const midnight = new Date(2026, 7, 24, 0, 0, 0, 0);
    const points = [
      { date: new Date(midnight.getTime() - 3_600_000).toISOString(), value: 132_000 },
      { date: new Date(midnight.getTime() + 3_600_000).toISOString(), value: 133_000 }
    ];

    expect(portfolioChangeSinceLocalMidnight(points, 134_640, new Date(2026, 7, 24, 12).getTime())).toMatchObject({
      baselineValue: 132_000,
      value: 2_640,
      percent: 2
    });
  });

  it('moves the baseline forward when the local calendar day changes', () => {
    const firstMidnight = new Date(2026, 7, 24, 0, 0, 0, 0);
    const secondMidnight = new Date(2026, 7, 25, 0, 0, 0, 0);
    const points = [
      { date: new Date(firstMidnight.getTime() - 3_600_000).toISOString(), value: 132_000 },
      { date: new Date(secondMidnight.getTime() - 3_600_000).toISOString(), value: 135_000 }
    ];

    expect(portfolioChangeSinceLocalMidnight(points, 136_350, new Date(2026, 7, 25, 8).getTime())?.percent).toBeCloseTo(1);
  });

  it('does not invent a daily gain without a stored midnight baseline', () => {
    const now = new Date(2026, 7, 24, 12);
    const pointAfterMidnight = { date: new Date(2026, 7, 24, 1).toISOString(), value: 100 };

    expect(portfolioChangeSinceLocalMidnight([pointAfterMidnight], 110, now.getTime())).toBeUndefined();
  });
});
