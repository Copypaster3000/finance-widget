import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  native: true,
  load: vi.fn()
}));

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: mocked.load } }));

function emptyStore() {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined)
  };
}

describe('native persistence resilience', () => {
  beforeEach(() => {
    mocked.native = true;
    const browserValues = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => browserValues.clear(),
        getItem: (key: string) => browserValues.get(key) ?? null,
        setItem: (key: string, value: string) => browserValues.set(key, value),
        removeItem: (key: string) => browserValues.delete(key)
      }
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mocked.native ? { __TAURI_INTERNALS__: {} } : {}
    });
    vi.resetModules();
    mocked.load.mockReset();
    localStorage.clear();
  });

  it('retries a transient native store startup failure', async () => {
    const appStore = emptyStore();
    mocked.load.mockRejectedValueOnce(new Error('store busy')).mockRejectedValueOnce(new Error('store busy')).mockResolvedValue(appStore);
    const { loadState } = await import('./storage');

    const state = await loadState();

    expect(mocked.load).toHaveBeenCalledTimes(3);
    expect(state.ledger.assets).toEqual([]);
  });

  it('never substitutes an empty browser store when native loading fails', async () => {
    localStorage.setItem('portfolio-ledger-v1', JSON.stringify({ schemaVersion: 2, assets: [], events: [] }));
    mocked.load.mockRejectedValue(new Error('store unavailable'));
    const { loadState, StorageUnavailableError } = await import('./storage');

    await expect(loadState()).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(mocked.load).toHaveBeenCalledTimes(4);
  });

  it('serializes concurrent writes to the shared native store', async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const appStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      }),
      save: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeWrites -= 1;
      })
    };
    mocked.load.mockResolvedValue(appStore);
    const [{ saveConfig, saveLedger }, { DEFAULT_CONFIG }] = await Promise.all([import('./storage'), import('./defaults')]);

    await Promise.all([
      saveLedger({ schemaVersion: 2, assets: [], events: [] }),
      saveConfig(structuredClone(DEFAULT_CONFIG))
    ]);

    expect(maximumActiveWrites).toBe(1);
    expect(appStore.save).toHaveBeenCalledTimes(2);
  });

  it('keeps localStorage support for the browser preview only', async () => {
    mocked.native = false;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    localStorage.setItem('portfolio-ledger-v1', JSON.stringify({ schemaVersion: 2, assets: [], events: [] }));
    const { loadState } = await import('./storage');

    const state = await loadState();

    expect(mocked.load).not.toHaveBeenCalled();
    expect(state.ledger.schemaVersion).toBe(2);
  });
});
