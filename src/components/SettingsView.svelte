<script lang="ts">
  import Icon from './Icon.svelte';
  import { version } from '../../package.json';
  import { localCalendarDate } from '../lib/calendar';
  import { isIsoDate } from '../lib/history';
  import type { AppConfig, RefreshMode } from '../lib/types';
  export let config: AppConfig;
  export let autoHistoryStartDate: string;
  export let onApply: (config: AppConfig) => void | Promise<void>;
  export let onBack: () => void;

  let draft: AppConfig;
  let saveError = '';
  let saving = false;
  const today = localCalendarDate();
  function initializeDraft(source: AppConfig, automaticDate: string): AppConfig {
    const next = structuredClone(source);
    if (next.historyStartMode === 'auto') next.historyStartDate = automaticDate;
    return next;
  }
  $: draft = initializeDraft(config, autoHistoryStartDate);

  const modes: { value: RefreshMode; label: string }[] = [
    { value: 'manual', label: 'MANUAL' }, { value: '1h', label: 'HOURLY' }, { value: '15m', label: '15 MIN' }, { value: '15s', label: '15 SEC' }
  ];
  const modeDescriptions: Record<RefreshMode, string> = {
    manual: 'No automatic price checks. Use Refresh when you want an update.',
    '1h': 'Checks hourly. Closed stock markets are still monitored without implying a new price.',
    '15m': 'Checks every 15 minutes. Existing prices remain visible between checks.',
    '15s': 'Checks every 15 seconds. This is polling, not a streaming market feed.'
  };

  function adjustTextScale(delta: number) { draft.appearance.scale = Math.round(Math.min(1.4, Math.max(0.8, draft.appearance.scale + delta)) * 10) / 10; }
  async function apply() {
    if (saving) return;
    if (!isIsoDate(draft.historyStartDate) || draft.historyStartDate > localCalendarDate()) { saveError = 'Enter a valid history start date that is not in the future.'; return; }
    saving = true; saveError = '';
    try { await onApply({ ...draft, schemaVersion: 10, historyStartDate: draft.historyStartDate || autoHistoryStartDate }); }
    catch (error) { saveError = `Save failed: ${String(error)}`; }
    finally { saving = false; }
  }
  function useAutomaticHistoryStart() { draft.historyStartMode = 'auto'; draft.historyStartDate = autoHistoryStartDate; }
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && onBack()}/>

<main class="settings-view">
  <section class="config-section">
    <div class="config-heading"><span>01</span><h2>PRICE FEED</h2><i>YAHOO</i></div>
    <div class="setting-block"><span class="setting-label">STOCK SESSION</span><div class="segmented"><button aria-pressed={draft.stockSession === 'regular'} class:active={draft.stockSession === 'regular'} on:click={() => draft.stockSession = 'regular'}>NORMAL</button><button aria-pressed={draft.stockSession === 'extended'} class:active={draft.stockSession === 'extended'} on:click={() => draft.stockSession = 'extended'}>EXTENDED</button></div><p>Extended uses Yahoo pre-market, post-market, and available overnight quotes.</p></div>
    <div class="setting-block history-start-setting"><span class="setting-label">HISTORY START</span><div class="segmented"><button aria-pressed={draft.historyStartMode === 'auto'} class:active={draft.historyStartMode === 'auto'} on:click={useAutomaticHistoryStart}>AUTO / EARLIEST BUY</button><button aria-pressed={draft.historyStartMode === 'manual'} class:active={draft.historyStartMode === 'manual'} on:click={() => draft.historyStartMode = 'manual'}>MANUAL</button></div><div class="setting-row"><label for="history-start">START DATE</label><input id="history-start" type="date" min="1970-01-01" max={today} bind:value={draft.historyStartDate} on:input={() => draft.historyStartMode = 'manual'}/></div><p>{draft.historyStartMode === 'auto' ? 'Moves automatically when the earliest Buy changes.' : 'Pinned to this date, even before the first Buy.'}</p></div>
    <div class="setting-block"><span class="setting-label">UPDATE MODE</span><div class="segmented modes">{#each modes as mode}<button aria-pressed={draft.refreshMode === mode.value} class:active={draft.refreshMode === mode.value} on:click={() => draft.refreshMode = mode.value}>{mode.label}</button>{/each}</div><p>{modeDescriptions[draft.refreshMode]}</p></div>
  </section>

  <section class="config-section">
    <div class="config-heading"><span>02</span><h2>INTERFACE</h2><i>LOCAL</i></div>
    <div class="setting-block"><span class="setting-label">ACCENT</span><div class="segmented"><button aria-pressed={draft.appearance.accent === 'amber'} class:active={draft.appearance.accent === 'amber'} on:click={() => draft.appearance.accent = 'amber'}>AMBER</button><button aria-pressed={draft.appearance.accent === 'cyan'} class:active={draft.appearance.accent === 'cyan'} on:click={() => draft.appearance.accent = 'cyan'}>CYAN</button><button aria-pressed={draft.appearance.accent === 'mono'} class:active={draft.appearance.accent === 'mono'} on:click={() => draft.appearance.accent = 'mono'}>MONO</button></div></div>
    <div class="range-row"><label for="opacity">PANEL OPACITY <strong>{Math.round(draft.appearance.opacity * 100)}%</strong></label><input id="opacity" type="range" min="0.7" max="0.96" step="0.01" bind:value={draft.appearance.opacity}/></div>
    <div class="font-scale-row">
      <span class="setting-label">TEXT SIZE</span>
      <div class="font-scale-control">
        <button aria-label="Decrease widget text size" title="Decrease text size" disabled={draft.appearance.scale <= 0.8} on:click={() => adjustTextScale(-0.1)}><Icon name="minus" size={13}/></button>
        <strong>{Math.round(draft.appearance.scale * 100)}%</strong>
        <button aria-label="Increase widget text size" title="Increase text size" disabled={draft.appearance.scale >= 1.4} on:click={() => adjustTextScale(0.1)}><Icon name="plus" size={13}/></button>
      </div>
    </div>
    <div class="toggle-grid">
      <label><input type="checkbox" bind:checked={draft.appearance.showHistory}/><span></span>HISTORY GRAPH</label>
      <label><input type="checkbox" bind:checked={draft.appearance.showPrice}/><span></span>UNIT PRICE</label>
      <label><input type="checkbox" bind:checked={draft.appearance.showQuantity}/><span></span>QUANTITY</label>
      <label><input type="checkbox" bind:checked={draft.appearance.showDailyChange}/><span></span>DAILY CHANGE</label>
      <label><input type="checkbox" bind:checked={draft.appearance.showCash}/><span></span>CASH ROW</label>
      <label><input type="checkbox" bind:checked={draft.appearance.showDebt}/><span></span>MARGIN DEBT ROW</label>
      <label><input type="checkbox" bind:checked={draft.launchAtStartup}/><span></span>START WITH WINDOWS</label>
      <label><input type="checkbox" bind:checked={draft.showInTaskbar}/><span></span>TASKBAR ICON</label>
      <label><input type="checkbox" checked={draft.windowMode === 'alwaysOnTop'} on:change={(event) => draft.windowMode = (event.currentTarget as HTMLInputElement).checked ? 'alwaysOnTop' : 'normal'}/><span></span>ALWAYS ON TOP</label>
    </div>
    <p class="setting-note">Account-row visibility only. Hidden balances still affect net value and history.</p>
  </section>

  {#if saveError}<p class="form-error" role="alert">{saveError}</p>{/if}
  <div class="settings-footer"><span>V{version} / LOCAL LEDGER</span><button class="apply-button" disabled={saving} on:click={apply}><Icon name="check" size={14}/> {saving ? 'SAVING' : 'APPLY CONFIG'}</button></div>
</main>
