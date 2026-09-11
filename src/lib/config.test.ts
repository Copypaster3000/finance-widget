import { describe, expect, it } from 'vitest';
import { normalizeConfig, normalizeAppearanceScale, normalizeHistoryRange, normalizeRefreshMode, normalizeStockSession } from './config';
import { DEFAULT_CONFIG } from './defaults';

describe('configuration', () => {
  it.each(['2020-02-30', '2020-13-01', 'not-a-date', '', 42])('rejects malformed stored calendar date %s', (historyStartDate) => {
    expect(() => normalizeConfig({ schemaVersion: 10, historyStartDate })).toThrow('INTEGRITY_ERROR');
  });
  it.each([{}, [], 42, { schemaVersion: 0 }])('rejects malformed configuration %j', value => {
    expect(() => normalizeConfig(value)).toThrow('INTEGRITY_ERROR');
  });
  it('defaults missing configuration and accepts a real leap day', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({ schemaVersion: 1, historyStartDate: '2020-02-29' }).historyStartDate).toBe('2020-02-29');
  });
  it('serializes and deserializes configuration', () => {
    expect(normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)))).toEqual(DEFAULT_CONFIG);
  });

  it('persists the optional history graph preference', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.appearance.showHistory = false;
    expect(normalizeConfig(JSON.parse(JSON.stringify(config))).appearance.showHistory).toBe(false);
  });

  it('rejects unsupported schemas', () => {
    expect(() => normalizeConfig(JSON.parse('{"schemaVersion":99}'))).toThrow(/schema/i);
  });

  it('migrates schema 1 and adds the default history start date', () => {
    const migrated = normalizeConfig(JSON.parse('{"schemaVersion":1,"holdings":[]}'));
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.historyStartDate).toBe(DEFAULT_CONFIG.historyStartDate);
    expect(migrated.historyStartMode).toBe('auto');
    expect(migrated.showInTaskbar).toBe(false);
    expect(migrated.appearance.showHistory).toBe(true);
    expect(migrated.stockSession).toBe('extended');
    expect(migrated.appearance.historyRange).toBe('all');
    expect(migrated.appearance.showCash).toBe(true);
    expect(migrated.appearance.showDebt).toBe(true);
  });

  it('removes legacy provider credentials while migrating saved configuration', () => {
    const migrated = normalizeConfig(JSON.parse('{"schemaVersion":2,"holdings":[],"provider":"twelveData","twelveDataApiKey":"legacy-key","fmpApiKey":"legacy-key"}'));
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated).not.toHaveProperty('provider');
    expect(migrated).not.toHaveProperty('twelveDataApiKey');
    expect(migrated).not.toHaveProperty('fmpApiKey');
  });

  it('defaults account rows off for new profiles and preserves explicit schema 10 choices', () => {
    expect(DEFAULT_CONFIG.appearance).toMatchObject({ showCash: false, showDebt: false });
    const config = structuredClone(DEFAULT_CONFIG);
    config.appearance.showCash = true;
    expect(normalizeConfig(JSON.parse(JSON.stringify(config))).appearance).toMatchObject({ showCash: true, showDebt: false });
  });

  it('persists an explicitly manual history start mode', () => {
    const config = { ...structuredClone(DEFAULT_CONFIG), historyStartMode: 'manual' as const, historyStartDate: '2026-08-01' };
    expect(normalizeConfig(JSON.parse(JSON.stringify(config)))).toMatchObject({ historyStartMode: 'manual', historyStartDate: '2026-08-01' });
  });

  it('normalizes removed refresh modes to supported choices', () => {
    expect(normalizeRefreshMode('5m')).toBe('15m');
    expect(normalizeRefreshMode('1m')).toBe('15m');
    expect(normalizeRefreshMode('live')).toBe('15s');
    expect(normalizeRefreshMode('unexpected')).toBe('manual');
  });

  it('persists regular hours and defaults unknown stock sessions to extended', () => {
    expect(normalizeStockSession('regular')).toBe('regular');
    expect(normalizeStockSession('extended')).toBe('extended');
    expect(normalizeStockSession('unexpected')).toBe('extended');
    const config = structuredClone(DEFAULT_CONFIG);
    config.stockSession = 'regular';
    expect(normalizeConfig(JSON.parse(JSON.stringify(config))).stockSession).toBe('regular');
  });

  it('bounds and quantizes the responsive text scale', () => {
    expect(normalizeAppearanceScale(0.2)).toBe(0.8);
    expect(normalizeAppearanceScale(1.26)).toBe(1.3);
    expect(normalizeAppearanceScale(9)).toBe(1.4);
    expect(normalizeAppearanceScale('invalid')).toBe(1);
  });

  it('persists supported history ranges and defaults unknown values to max', () => {
    expect(normalizeHistoryRange('1h')).toBe('1h');
    expect(normalizeHistoryRange('1m')).toBe('1m');
    expect(normalizeHistoryRange('unexpected')).toBe('all');
    const config = structuredClone(DEFAULT_CONFIG);
    config.appearance.historyRange = '1w';
    expect(normalizeConfig(JSON.parse(JSON.stringify(config))).appearance.historyRange).toBe('1w');
  });

});
