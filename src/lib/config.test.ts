import { describe, expect, it } from 'vitest';
import { addHolding, deserializeConfig, editHolding, normalizeAppearanceScale, normalizeHistoryRange, normalizeRefreshMode, normalizeStockSession, removeHolding, serializeConfig } from './config';
import { DEFAULT_CONFIG } from './defaults';

describe('configuration', () => {
  it('serializes and deserializes configuration', () => {
    const encoded = serializeConfig(DEFAULT_CONFIG);
    expect(deserializeConfig(encoded)).toEqual(DEFAULT_CONFIG);
  });

  it('persists the optional history graph preference', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.appearance.showHistory = false;
    expect(deserializeConfig(serializeConfig(config)).appearance.showHistory).toBe(false);
  });

  it('rejects unsupported schemas', () => {
    expect(() => deserializeConfig('{"schemaVersion":99}')).toThrow(/schema/i);
  });

  it('migrates schema 1 and adds the default history start date', () => {
    const migrated = deserializeConfig('{"schemaVersion":1,"holdings":[]}');
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
    const migrated = deserializeConfig('{"schemaVersion":2,"holdings":[],"provider":"twelveData","twelveDataApiKey":"legacy-key","fmpApiKey":"legacy-key"}');
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated).not.toHaveProperty('provider');
    expect(migrated).not.toHaveProperty('twelveDataApiKey');
    expect(migrated).not.toHaveProperty('fmpApiKey');
  });

  it('defaults account rows off for new profiles and preserves explicit schema 10 choices', () => {
    expect(DEFAULT_CONFIG.appearance).toMatchObject({ showCash: false, showDebt: false });
    const config = structuredClone(DEFAULT_CONFIG);
    config.appearance.showCash = true;
    expect(deserializeConfig(serializeConfig(config)).appearance).toMatchObject({ showCash: true, showDebt: false });
  });

  it('persists an explicitly manual history start mode', () => {
    const config = { ...structuredClone(DEFAULT_CONFIG), historyStartMode: 'manual' as const, historyStartDate: '2026-08-01' };
    expect(deserializeConfig(serializeConfig(config))).toMatchObject({ historyStartMode: 'manual', historyStartDate: '2026-08-01' });
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
    expect(deserializeConfig(serializeConfig(config)).stockSession).toBe('regular');
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
    expect(deserializeConfig(serializeConfig(config)).appearance.historyRange).toBe('1w');
  });

  it('adds, edits and removes holdings immutably', () => {
    const added = addHolding([], { id: 'x', symbol: 'MSFT', type: 'stock', quantity: 1 });
    const edited = editHolding(added, 'x', { quantity: 2.5 });
    const removed = removeHolding(edited, 'x');
    expect(added[0].quantity).toBe(1);
    expect(edited[0].quantity).toBe(2.5);
    expect(removed).toEqual([]);
  });
});
