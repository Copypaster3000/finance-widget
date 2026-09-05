import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocked.invoke }));

describe('native persistence', () => {
  beforeEach(() => {
    vi.resetModules(); mocked.invoke.mockReset();
    const values = new Map<string,string>();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('localStorage', { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value) });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('retries native read errors without substituting browser data', async () => {
    mocked.invoke.mockRejectedValueOnce('Cannot read').mockResolvedValue({data:{},metadata:{state:'firstRunEmpty'}});
    const { loadState } = await import('./storage');
    await loadState(); expect(mocked.invoke).toHaveBeenCalledTimes(2);
  });
  it('desktop release stays native even when bridge is missing', async () => {
    vi.stubEnv('MODE','desktop'); vi.stubGlobal('window', {});
    mocked.invoke.mockRejectedValue('Bridge unavailable');
    const { loadState } = await import('./storage');
    await expect(loadState()).rejects.toThrow('Bridge unavailable');
    expect(mocked.invoke).toHaveBeenCalledTimes(4);
  });
  it('returns recovery metadata and discards bad caches without discarding the ledger',async()=>{
    mocked.invoke.mockResolvedValue({data:{'portfolio-ledger-v1':{schemaVersion:2,assets:[],events:[]},'quote-cache':42,'history-cache-v1':'bad','ledger-price-history-v1':{schemaVersion:1,entries:{bad:{symbol:42}}}},metadata:{state:'portfolioRecovered',recoveryReason:'damaged primary',backupModifiedAt:1234}});
    const {loadState}=await import('./storage');const state=await loadState();
    expect(state.metadata.state).toBe('portfolioRecovered');expect(state.quotes).toEqual([]);expect(state.historyCache).toEqual({});expect(state.ledgerPriceCache.entries).toEqual({});expect(state.ledgerMigrated).toBe(false);
  });
  it('rejects malformed authoritative history even if a bridge returns it',async()=>{
    mocked.invoke.mockResolvedValue({data:{'portfolio-ledger-v1':{schemaVersion:2,assets:[],events:[null]}},metadata:{state:'portfolioLoaded'}});
    const {loadState}=await import('./storage');await expect(loadState()).rejects.toThrow('INTEGRITY_ERROR');expect(mocked.invoke).toHaveBeenCalledTimes(1);
  });
  it('reports failed writes and never calls them successful browser saves', async () => {
    mocked.invoke.mockRejectedValue('Disk full');
    const { saveLedger } = await import('./storage');
    await expect(saveLedger({schemaVersion:2,assets:[],events:[]})).rejects.toBe('Disk full');
    expect(localStorage.getItem('portfolio-ledger-v1')).toBeNull();
  });
  it('commits a ledger edit and its dependent settings in one native write', async () => {
    mocked.invoke.mockResolvedValue(undefined);
    const [{saveLedgerState}, {DEFAULT_CONFIG}, {EMPTY_HOURLY_CACHE}, {EMPTY_LEDGER_PRICE_CACHE}] = await Promise.all([import('./storage'),import('./defaults'),import('./hourly'),import('./ledgerHistory')]);
    await saveLedgerState({schemaVersion:2,assets:[],events:[]},DEFAULT_CONFIG,EMPTY_HOURLY_CACHE,EMPTY_LEDGER_PRICE_CACHE);
    expect(mocked.invoke).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocked.invoke.mock.calls[0][1].updates)).toHaveLength(4);
  });
  it('serializes writes and allows the queue to continue after a rejected save', async () => {
    let active = 0;
    let maximum = 0;
    mocked.invoke.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    const { saveLedger } = await import('./storage');
    const ledger = { schemaVersion: 2 as const, assets: [], events: [] };
    await Promise.all([saveLedger(ledger), saveLedger(ledger)]);
    expect(maximum).toBe(1);
    mocked.invoke.mockRejectedValueOnce('Save blocked');
    await expect(saveLedger(ledger)).rejects.toBe('Save blocked');
    await expect(saveLedger(ledger)).resolves.toBeUndefined();
  });
  it('uses browser storage only in browser preview', async () => {
    vi.stubGlobal('window', {});
    const {loadState}=await import('./storage');
    expect((await loadState()).ledger.assets).toEqual([]);
    expect(mocked.invoke).not.toHaveBeenCalled();
  });
});
