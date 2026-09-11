// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './lib/defaults';
import { EMPTY_HOURLY_CACHE } from './lib/hourly';
import { EMPTY_LEDGER_PRICE_CACHE } from './lib/ledgerHistory';
import App from './App.svelte';
import capability from '../src-tauri/capabilities/default.json';
import { migrateLegacyHoldings } from './lib/ledger';

const mocks = vi.hoisted(() => ({ loadState: vi.fn(), saveConfig: vi.fn(), native: vi.fn(), setMinSize: vi.fn(), setAlwaysOnTop: vi.fn(), getWindow: vi.fn() }));
vi.mock('./lib/storage', () => ({
  hasNativeBridge: mocks.native, loadState: mocks.loadState, saveConfig: mocks.saveConfig,
  saveHistoryCache: vi.fn(), saveLedger: vi.fn(), saveLedgerState: vi.fn(), saveLedgerPriceCache: vi.fn(), saveQuotes: vi.fn(), saveRefreshCache: vi.fn()
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getWindow }));
vi.mock('./lib/providers', () => ({ createProvider: () => ({ name: 'synthetic', getQuotes: vi.fn().mockResolvedValue({ quotes: [], errors: [] }) }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue(false);
  mocks.saveConfig.mockResolvedValue(undefined);
  mocks.setMinSize.mockResolvedValue(undefined);
  mocks.setAlwaysOnTop.mockResolvedValue(undefined);
  mocks.getWindow.mockReturnValue({ setMinSize: mocks.setMinSize, setAlwaysOnTop: mocks.setAlwaysOnTop, setSkipTaskbar: vi.fn().mockResolvedValue(undefined), outerSize: vi.fn().mockResolvedValue({ width: 474, height: 700 }), scaleFactor: vi.fn().mockResolvedValue(1), onResized: vi.fn().mockResolvedValue(vi.fn()) });
  mocks.loadState.mockResolvedValue({ config: structuredClone(DEFAULT_CONFIG), ledger: { schemaVersion: 2, assets: [], events: [] }, quotes: [], historyCache: {}, ledgerPriceCache: EMPTY_LEDGER_PRICE_CACHE, hourlyHistory: EMPTY_HOURLY_CACHE, ledgerMigrated: false, configMigrated: false, metadata: { state: 'firstRunEmpty' } });
});
afterEach(cleanup);

describe('minimum window size capability and transitions', () => {
  it('grants the narrow minimum-size permission to the main window', () => {
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toContain('core:window:allow-set-min-size');
    expect(capability.permissions).not.toContain('core:window:default');
  });

  it.each([1, 2])('preserves editing minima across all views at scale %s', async scale => {
    mocks.native.mockReturnValue(true);
    const nativeWindow = mocks.getWindow();
    nativeWindow.outerSize.mockResolvedValue({ width: 120 * scale, height: 192 * scale });
    nativeWindow.scaleFactor.mockResolvedValue(scale);
    nativeWindow.setSize = vi.fn().mockResolvedValue(undefined);
    // Model the actual permission gate, not an unconditionally successful mock.
    mocks.setMinSize.mockImplementation(async () => {
      if (!capability.permissions.includes('core:window:allow-set-min-size')) throw new Error('permission denied');
    });
    const state = await mocks.loadState();
    state.config.appearance.showCash = true;
    state.config.appearance.showDebt = true;
    state.ledger = migrateLegacyHoldings([{ id: 'synthetic', symbol: 'SYNTH', type: 'stock', quantity: 1 }], '2020-01-01');
    state.config.historyStartDate = '2020-01-01';
    render(App);
    await waitFor(() => expect(mocks.setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 120, height: 192 })));
    async function editing() {
      await waitFor(() => expect(mocks.setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 360, height: 480 })));
      expect(nativeWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 360, height: 480 }));
      expect(screen.queryByText(/WINDOW UPDATE FAILED/)).toBeNull();
    }
    async function portfolio() {
      await fireEvent.click(screen.getByRole('button', { name: 'Back to portfolio' }));
      await waitFor(() => expect(mocks.setMinSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 120, height: 192 })));
      expect(screen.queryByText(/WINDOW UPDATE FAILED/)).toBeNull();
    }
    await fireEvent.click(await screen.findByRole('button', { name: /^SYNTH / }));
    await editing();
    await fireEvent.click(screen.getByRole('button', { name: '+ BUY' }));
    expect(screen.getByRole('button', { name: 'ADD BUY' })).toBeTruthy();
    await editing();
    await fireEvent.click(screen.getByRole('button', { name: 'SYNTH' }));
    await fireEvent.click(screen.getByRole('button', { name: '+ SELL' }));
    expect(screen.getByRole('button', { name: 'ADD SELL' })).toBeTruthy();
    await editing();
    await portfolio();
    for (const name of [/^CASH /, /^MARGIN DEBT /]) {
      await fireEvent.click(screen.getByRole('button', { name }));
      await editing();
      await portfolio();
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await editing();
    await portfolio();
  });
});
describe('application operation failures', () => {
  it('retains the saved range on failure, reports it, and permits retry', async () => {
    render(App);
    await screen.findByText('NO ASSETS TRACKED');
    mocks.saveConfig.mockRejectedValueOnce(new Error('synthetic write failure'));
    await fireEvent.click(screen.getByRole('button', { name: '1HR' }));
    expect((await screen.findByRole('alert')).textContent).toContain('HISTORY RANGE NOT SAVED');
    expect(screen.getByRole('button', { name: 'MAX' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: '1HR' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '1HR' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('skips native window operations in browser preview without interrupting initialization', async () => {
    render(App);
    await screen.findByText('NO ASSETS TRACKED');
    expect(mocks.getWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reports a real native window failure separately from storage errors', async () => {
    mocks.native.mockReturnValue(true);
    mocks.setAlwaysOnTop.mockRejectedValueOnce(new Error('synthetic native failure'));
    render(App);
    expect((await screen.findByRole('alert')).textContent).toContain('WINDOW UPDATE FAILED');
    expect(screen.queryByText('PORTFOLIO DATA NEEDS ATTENTION')).toBeNull();
  });
});
