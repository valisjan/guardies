import { createApp } from 'vue';
import { createPinia } from 'pinia';
import GuardiesChrome from './components/GuardiesChrome.vue';

const app = createApp(GuardiesChrome);
app.use(createPinia());
app.mount('#guardies-chrome-root');

// La lògica antiga s'inicia quan Vue ja ha creat tots els nodes que consulta.
import('./main.js');
