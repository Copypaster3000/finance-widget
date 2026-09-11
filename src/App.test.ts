// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './lib/defaults';
import { EMPTY_HOURLY_CACHE } from './lib/hourly';
import { EMPTY_LEDGER_PRICE_CACHE } from './lib/ledgerHistory';
import App from './App.svelte';

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
