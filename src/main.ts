import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import './styles.css';

mount(App, { target: document.getElementById('app')! });
