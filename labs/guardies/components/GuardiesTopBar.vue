<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import GuardiesDateNav from './GuardiesDateNav.vue';

const dark = ref(document.documentElement.classList.contains('dark'));
const {
  courseId, date, isAdmin, teacherView, contextReady, canWrite, authRequired,
  adminSection, teacherSection, persistenceStatus, dayPersistenceStatus, updatedAt,
} = storeToRefs(useGuardiesStore());
const netlifyMode = window.location.hostname.endsWith('.netlify.app');
const appLinks = [
  { name: 'Quota', description: 'Assignació de classes', href: netlifyMode ? 'https://chic-tartufo-68ee9c.netlify.app/' : 'https://quota.iessureda.com/' },
  { name: 'Pantalles', description: 'Pantalles del centre', href: netlifyMode ? 'https://pantalles.netlify.app/?gestio=1&pantalla=sala-professorat' : 'https://pantalles.iessureda.com/?gestio=1&pantalla=sala-professorat' },
  { name: 'Retards', description: "Retards de l'alumnat", href: netlifyMode ? 'https://spontaneous-gecko-a2703a.netlify.app/' : 'https://retards.iessureda.com/' },
];
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

// La data només té sentit a la gestió diària i a les guàrdies del dia.
const showDate = computed(() => contextReady.value && !authRequired.value && (
  (canWrite.value && adminSection.value === 'daily') || (!canWrite.value && teacherSection.value === 'daily')
));

const syncState = computed(() => {
  const states = [persistenceStatus.value, dayPersistenceStatus.value];
  if (states.includes('loading')) return { tone: 'saving', label: 'Connectant…' };
  if (states.includes('saving')) return { tone: 'saving', label: 'Guardant…' };
  if (states.includes('stale')) return { tone: 'stale', label: 'Dades locals' };
  if (states.includes('error')) return { tone: 'error', label: 'Error de connexió' };
  if (dayPersistenceStatus.value === 'refreshing') return { tone: 'saving', label: 'Actualitzant…' };
  return { tone: 'ready', label: 'Sincronitzat' };
});
const lastSyncLabel = computed(() => {
  if (!updatedAt.value) return '';
  const parsed = new Date(updatedAt.value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('ca-ES', { hour: '2-digit', minute: '2-digit' }).format(parsed);
});

function settleNavigation() {
  pendingTeacherView.value = null;
}
window.addEventListener('guardies:view-settled', settleNavigation);

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

// Menú d'aplicacions: es tanca en triar, en clicar fora o amb Escape.
const appsOpen = ref(false);
const appsMenu = ref(null);
function closeAppsOnOutside(event) {
  if (appsMenu.value && !appsMenu.value.contains(event.target)) appsOpen.value = false;
}
function closeAppsOnEscape(event) {
  if (event.key === 'Escape') appsOpen.value = false;
}
function toggleApps() {
  appsOpen.value = !appsOpen.value;
}
document.addEventListener('click', closeAppsOnOutside);
document.addEventListener('keydown', closeAppsOnEscape);
onBeforeUnmount(() => {
  window.removeEventListener('guardies:view-settled', settleNavigation);
  document.removeEventListener('click', closeAppsOnOutside);
  document.removeEventListener('keydown', closeAppsOnEscape);
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
      <a class="brand" :href="isAdmin ? guardiesHref : professoratHref" @click="openView($event, isAdmin ? guardiesHref : professoratHref, !isAdmin)">
        <img src="/logo_IESJSB_nav.png" alt="IES Josep Sureda i Blanes" />
        <span class="brand-title">Guàrdies</span>
      </a>

      <div ref="appsMenu" class="apps-menu">
        <button type="button" class="nav-chip-button" aria-haspopup="true" :aria-expanded="appsOpen" aria-controls="apps-menu-list" @click="toggleApps">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></svg>
          <span class="nav-chip-label">Apps</span>
        </button>
        <div v-if="appsOpen" id="apps-menu-list" class="apps-popover">
          <a v-for="app in appLinks" :key="app.name" :href="app.href" class="apps-link">
            <strong>{{ app.name }}</strong>
            <small>{{ app.description }}</small>
          </a>
        </div>
      </div>

      <div v-if="isAdmin" class="view-switch" role="group" aria-label="Vista">
        <a :class="{ active: !activeTeacherView }" :href="guardiesHref" :aria-current="!activeTeacherView ? 'page' : undefined" @click="openView($event, guardiesHref, false)">Guàrdies</a>
        <a :class="{ active: activeTeacherView }" :href="professoratHref" :aria-current="activeTeacherView ? 'page' : undefined" @click="openView($event, professoratHref, true)">Professorat</a>
      </div>

      <div class="nav-center">
        <GuardiesDateNav v-show="showDate" />
      </div>

      <div v-if="contextReady && canWrite" class="nav-status" :class="`is-${syncState.tone}`" role="status">
        <span class="nav-status-dot" aria-hidden="true"></span>
        <span class="nav-status-label">{{ syncState.label }}</span>
        <span v-if="lastSyncLabel" class="nav-status-time">· {{ lastSyncLabel }}</span>
      </div>

      <button id="theme-toggle" type="button" class="nav-icon-button" :aria-label="dark ? 'Activa el tema clar' : 'Activa el tema fosc'" :title="dark ? 'Tema clar' : 'Tema fosc'" @click="toggleTheme">
        <svg v-if="dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
      </button>
    </div>
    <div class="nav-progress" :class="{ active: loading }" role="progressbar" aria-label="Carregant" :aria-hidden="!loading"></div>
  </nav>
</template>
