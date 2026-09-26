import { createApp } from 'vue';
import { createPinia } from 'pinia';
import GuardiesChrome from './components/GuardiesChrome.vue';

const app = createApp(GuardiesChrome);
app.use(createPinia());
app.mount('#guardies-chrome-root');

// La lògica antiga s'inicia quan Vue ja ha creat tots els nodes que consulta.
import('./main.js');

// Aplicació instal·lable i arrencada ràpida: el codi de cada versió queda al
// dispositiu. Només en producció (no en desenvolupament ni en les proves).
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_E2E_AUTH_BYPASS !== 'true') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
