<script lang="ts">
  import type { AssetType } from '../lib/types';
  import Icon from './Icon.svelte';
  export let onBack: () => void;
  export let onAdd: (symbol: string, type: AssetType) => Promise<string | undefined>;
  let symbol = '';
  let type: AssetType = 'stock';
  let error = '';
  let working = false;

  async function submit() {
    const clean = symbol.trim().toUpperCase();
    if (!clean) { error = 'ENTER A SYMBOL'; return; }
    working = true;
    error = (await onAdd(clean, type)) ?? '';
    working = false;
  }
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && onBack()}/>

<main class="detail-view">
  <div class="detail-heading"><button class="detail-back" on:click={onBack}><Icon name="back" size={13}/> PORTFOLIO</button><span>NEW ASSET</span></div>
  <section class="detail-card entry-card">
    <div class="detail-code">ASSET / REGISTER</div>
    <label>SYMBOL<input maxlength="12" bind:value={symbol} on:input={() => symbol = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '')} on:keydown={(event) => event.key === 'Enter' && void submit()}/></label>
    <label>CLASS<select bind:value={type}><option value="stock">STOCK</option><option value="crypto">CRYPTO</option></select></label>
    {#if error}<p class="form-error">{error}</p>{/if}
    <button class="apply-button full-action" disabled={working} on:click={() => void submit()}><Icon name="plus" size={13}/>{working ? 'VALIDATING' : 'CONTINUE TO POSITION SETUP'}</button>
  </section>
  <p class="detail-note">After validation, add a Buy. Each Buy can include or exclude tracked Cash and Debt.</p>
</main>
