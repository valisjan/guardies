<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const dark = ref(document.documentElement.classList.contains('dark'));
const { courseId, date, isAdmin, teacherView, contextReady } = storeToRefs(useGuardiesStore());
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

// Vista triada que encara s'està carregant: la pestanya es marca a l'instant.
const pendingTeacherView = ref(null);
const activeTeacherView = computed(() => pendingTeacherView.value ?? teacherView.value);
const loading = computed(() => pendingTeacherView.value !== null || !contextReady.value);

function settleNavigation() {
  pendingTeacherView.value = null;
}
window.addEventListener('guardies:view-settled', settleNavigation);
onBeforeUnmount(() => window.removeEventListener('guardies:view-settled', settleNavigation));

// Guàrdies i Professorat es mostren sense recarregar la pàgina. Els clics amb
// modificadors (nova pestanya o finestra) conserven el comportament normal.
function openView(event, href, toTeacherView) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const target = new URL(href, window.location.href);
  if (target.search === window.location.search && toTeacherView === teacherView.value && pendingTeacherView.value === null) return;
  pendingTeacherView.value = toTeacherView;
  window.history.pushState(null, '', `${target.pathname}${target.search}`);
  window.dispatchEvent(new CustomEvent('guardies:navigate-view'));
}

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
      <a class="brand" :href="isAdmin ? guardiesHref : professoratHref" @click="openView($event, isAdmin ? guardiesHref : professoratHref, !isAdmin)">
        <img src="/logo_IESJSB_nav.png" alt="IES Josep Sureda i Blanes" />
        <span>
          <strong>GUÀRDIES</strong>
          <small>IES Josep Sureda i Blanes</small>
        </span>
      </a>
      <div class="nav-tabs" aria-label="Seccions">
        <a :href="appLinks.quota">Quota</a>
        <a v-if="isAdmin" :class="{ active: !activeTeacherView }" :href="guardiesHref" :aria-current="!activeTeacherView ? 'page' : undefined" @click="openView($event, guardiesHref, false)">Guàrdies</a>
        <a :class="{ active: activeTeacherView }" :href="professoratHref" :aria-current="activeTeacherView ? 'page' : undefined" @click="openView($event, professoratHref, true)">Professorat</a>
        <a :href="appLinks.pantalles">Pantalles</a>
        <a :href="appLinks.retards">Retards</a>
      </div>
      <button id="theme-toggle" type="button" class="theme-toggle" aria-label="Canvia el tema" @click="toggleTheme">
        <span class="theme-icon" aria-hidden="true">◐</span>
        <span id="theme-label">{{ dark ? 'Clar' : 'Fosc' }}</span>
      </button>
    </div>
    <div class="nav-progress" :class="{ active: loading }" role="progressbar" aria-label="Carregant" :aria-hidden="!loading"></div>
    <div class="brand-strip" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  </nav>
</template>
