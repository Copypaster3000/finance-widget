<script lang="ts">
  import Icon from './Icon.svelte';
  import type { RefreshMode } from '../lib/types';
  export let mode: RefreshMode;
  export let refreshing = false;
  export let context: 'portfolio' | 'settings' | 'ledger' | 'storage' = 'portfolio';
  export let privacyHidden = false;
  export let onRefresh: () => void;
  export let onPrivacy: () => void;
  export let onSettings: () => void;
  export let onClose: () => void;

  const modeLabels: Record<RefreshMode, string> = { manual: 'MANUAL', '1h': 'HOURLY', '15m': '15 MIN', '15s': '15 SEC' };
</script>

<header class="widget-header" data-tauri-drag-region>
  <div class="identity" data-tauri-drag-region>
    <span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>
    <div data-tauri-drag-region>
      <div class="eyebrow" data-tauri-drag-region>{context === 'settings' ? 'SYSTEM / CONFIG' : context === 'ledger' ? 'LOCAL / LEDGER' : context === 'storage' ? 'LOCAL / STORAGE' : 'LOCAL / PORTFOLIO'}</div>
      <div class="title" data-tauri-drag-region>{context === 'settings' ? 'CONFIGURATION' : context === 'ledger' ? 'ACCOUNT ACTIVITY' : context === 'storage' ? 'DATA CONNECTION' : 'FINANCE WIDGET'}</div>
    </div>
  </div>
  <div class="header-actions">
    {#if context === 'portfolio'}<div class:active={mode !== 'manual'} class="mode"><span></span>{modeLabels[mode]}</div>{/if}
    {#if context !== 'settings' && context !== 'storage'}<button class:active={privacyHidden} class="icon-button privacy-button" aria-pressed={privacyHidden} aria-label={privacyHidden ? 'Show portfolio values' : 'Hide portfolio values'} title={privacyHidden ? 'Show values' : 'Hide values'} on:click={onPrivacy}><Icon name={privacyHidden ? 'eyeOff' : 'eye'} /></button>{/if}
    {#if context === 'portfolio'}<button class:spinning={refreshing} class="icon-button refresh-button" aria-label="Refresh prices" title="Refresh prices" on:click={onRefresh}><Icon name="refresh" /></button>{/if}
    {#if context !== 'storage'}<button class:active={context === 'settings'} class="icon-button settings-button" aria-label={context === 'portfolio' ? 'Open settings' : 'Back to portfolio'} title={context === 'portfolio' ? 'Settings' : 'Back'} on:click={onSettings}><Icon name={context === 'portfolio' ? 'settings' : 'back'} /></button>{/if}
    <button class="icon-button close" aria-label="Close" title="Close" on:click={onClose}><Icon name="close" /></button>
  </div>
</header>
