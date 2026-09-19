<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const dark = ref(document.documentElement.classList.contains('dark'));
const { courseId, date, isAdmin, teacherView } = storeToRefs(useGuardiesStore());
const netlifyMode = window.location.hostname.endsWith('.netlify.app');
const appLinks = {
  quota: netlifyMode ? 'https://chic-tartufo-68ee9c.netlify.app/' : 'https://quota.iessureda.com/',
  guardies: netlifyMode ? 'https://guardies.netlify.app/' : 'https://guardies.iessureda.com/',
  pantalles: netlifyMode ? 'https://pantalles.netlify.app/?gestio=1&pantalla=sala-professorat' : 'https://pantalles.iessureda.com/?gestio=1&pantalla=sala-professorat',
  retards: netlifyMode ? 'https://spontaneous-gecko-a2703a.netlify.app/' : 'https://retards.iessureda.com/',
};
const guardiesHref = computed(() => {
  const query = new URLSearchParams();
  if (courseId.value) query.set('curs', courseId.value);
  if (date.value) query.set('data', date.value);
  const suffix = query.toString();
  return `/${suffix ? `?${suffix}` : ''}`;
});
const professoratHref = computed(() => {
  const query = new URLSearchParams();
  if (courseId.value) query.set('curs', courseId.value);
  if (date.value) query.set('data', date.value);
  query.set('vista', 'professor');
  return `/?${query.toString()}`;
});

function toggleTheme() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('quota_theme', dark.value ? 'dark' : 'light');
  localStorage.setItem('darkMode', dark.value ? 'true' : 'false');
}
</script>

<template>
  <nav class="app-nav" aria-label="Navegació principal">
    <div class="nav-inner">
      <a class="brand" :href="guardiesHref">
        <img src="/logo_IESJSB_nav.png" alt="IES Josep Sureda i Blanes" />
        <span>
          <strong>GUÀRDIES</strong>
          <small>IES Josep Sureda i Blanes</small>
        </span>
      </a>
      <div class="nav-tabs" aria-label="Seccions">
        <a :href="appLinks.quota">Quota</a>
        <a v-if="isAdmin" :class="{ active: !teacherView }" :href="guardiesHref" :aria-current="!teacherView ? 'page' : undefined">Guàrdies</a>
        <a :class="{ active: teacherView }" :href="professoratHref" :aria-current="teacherView ? 'page' : undefined">Professorat</a>
        <a :href="appLinks.pantalles">Pantalles</a>
        <a :href="appLinks.retards">Retards</a>
      </div>
      <button id="theme-toggle" type="button" class="theme-toggle" aria-label="Canvia el tema" @click="toggleTheme">
        <span class="theme-icon" aria-hidden="true">◐</span>
        <span id="theme-label">{{ dark ? 'Clar' : 'Fosc' }}</span>
      </button>
    </div>
    <div class="brand-strip" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  </nav>
</template>
