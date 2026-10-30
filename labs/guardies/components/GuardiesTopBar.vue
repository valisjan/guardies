<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import GuardiesDateNav from './GuardiesDateNav.vue';
import AppsMenu from '../../../src/shared/AppsMenu.vue';

const dark = ref(document.documentElement.classList.contains('dark'));
const {
  courseId, date, isAdmin, canRetards, teacherView, contextReady, canWrite, authRequired,
  adminSection, teacherSection, persistenceStatus, dayPersistenceStatus, updatedAt,
} = storeToRefs(useGuardiesStore());
const netlifyMode = window.location.hostname.endsWith('.netlify.app');
// Sense sessió no hi ha menú d'aplicacions (ni dades).
const signedIn = computed(() => contextReady.value && !authRequired.value);
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

// L'alçada de la barra (en mòbil ocupa dues files) permet fixar-hi elements a sota.
const navElement = ref(null);
let navObserver = null;
onMounted(() => {
  navObserver = new ResizeObserver(() => {
    const height = navElement.value?.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty('--app-nav-height', `${Math.round(height)}px`);
  });
  if (navElement.value) navObserver.observe(navElement.value);
});

onBeforeUnmount(() => {
  window.removeEventListener('guardies:view-settled', settleNavigation);
  navObserver?.disconnect();
});

function toggleTheme() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('quota_theme', dark.value ? 'dark' : 'light');
  localStorage.setItem('darkMode', dark.value ? 'true' : 'false');
}
</script>

<template>
  <nav ref="navElement" class="app-nav" aria-label="Navegació principal">
    <div class="nav-inner">
      <a class="brand" :href="isAdmin ? guardiesHref : professoratHref" @click="openView($event, isAdmin ? guardiesHref : professoratHref, !isAdmin)">
        <img src="/logo_IESJSB_nav.png" alt="IES Josep Sureda i Blanes" />
        <span class="brand-title">Guàrdies</span>
      </a>

      <AppsMenu current="guardies" :signed-in="signedIn" :is-admin="isAdmin" :can-retards="canRetards" :course-id="courseId" />

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
