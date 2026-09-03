<script lang="ts">
  export let name: 'refresh' | 'settings' | 'close' | 'minus' | 'plus' | 'back' | 'check' | 'eye' | 'eyeOff';
  export let size = 16;
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  {#if name === 'refresh'}<path d="M20 6v5h-5M4 18v-5h5M18.1 9A7 7 0 0 0 6.4 6.4L4 11M6 15a7 7 0 0 0 11.6 2.6L20 13" />
  {:else if name === 'settings'}<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>
  {:else if name === 'close'}<path d="M5 5 19 19M19 5 5 19" />
  {:else if name === 'minus'}<path d="M5 12h14" />
  {:else if name === 'plus'}<path d="M12 5v14M5 12h14" />
  {:else if name === 'back'}<path d="m15 5-7 7 7 7" />
  {:else if name === 'eye'}<path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>
  {:else if name === 'eyeOff'}<path d="M3 3 21 21M10.4 6.7A10.8 10.8 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a16 16 0 0 1-2.7 3.2M14.4 14.4A3.4 3.4 0 0 1 9.6 9.6M6.1 7.1A17 17 0 0 0 2.5 12s3.5 5.5 9.5 5.5a11 11 0 0 0 3-.4"/>
  {:else}<path d="m5 12 4 4L19 6" />{/if}
</svg>
