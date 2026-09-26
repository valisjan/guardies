<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const {
  date, absencies, assignacions, dayStatus, dayPersistenceStatus,
  persistenceStatus, updatedAt, canWrite, teacherView, unclosedDays,
  dayConflict, conflictRemoteClosed,
} = storeToRefs(store);

const xmlDay = computed(() => {
  if (!date.value) return '';
  const parsed = new Date(`${date.value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : String(parsed.getDay());
});

const selectedAbsences = computed(() => (
  Array.from(absencies.value.values()).filter((item) => item.dia === xmlDay.value)
));

const assignedAbsences = computed(() => selectedAbsences.value
  .filter((item) => assignacions.value.has(item.id)).length);

const syncLabel = computed(() => {
  if (persistenceStatus.value === 'loading' || dayPersistenceStatus.value === 'loading') return 'Connectant…';
  if (persistenceStatus.value === 'saving' || dayPersistenceStatus.value === 'saving') return 'Guardant…';
  if (persistenceStatus.value === 'stale' || dayPersistenceStatus.value === 'stale') return 'Dades locals';
  if (persistenceStatus.value === 'error' || dayPersistenceStatus.value === 'error') return 'Error de connexió';
  if (dayPersistenceStatus.value === 'refreshing') return 'Actualitzant…';
  return 'Sincronitzat';
});

const syncClass = computed(() => {
  const persistence = persistenceStatus.value;
  const dayPersistence = dayPersistenceStatus.value;
  if (persistence === 'error' || dayPersistence === 'error') return { 'sync-error': true };
  if (persistence === 'stale' || dayPersistence === 'stale') return { 'sync-stale': true };
  if (['loading', 'saving', 'refreshing'].includes(persistence) || ['loading', 'saving', 'refreshing'].includes(dayPersistence)) {
    return { 'sync-saving': true };
  }
  return { 'sync-ready': true };
});

const lastSyncLabel = computed(() => {
  if (!updatedAt.value) return 'Sense canvis guardats';
  const parsed = new Date(updatedAt.value);
  if (Number.isNaN(parsed.getTime())) return 'Última sincronització desconeguda';
  return `Actualitzat ${new Intl.DateTimeFormat('ca-ES', { hour: '2-digit', minute: '2-digit' }).format(parsed)}`;
});

function formatDate(value) {
  if (!value) return 'Sense data';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ca-ES', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(parsed);
}

function formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

function localDateString(value) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function onDateChange(event) {
  requestDate(event.target.value);
  event.target.value = date.value;
}

function requestDate(value) {
  window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: value } }));
}

function shiftDate(days) {
  if (!date.value) return;
  const parsed = new Date(`${date.value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  parsed.setDate(parsed.getDate() + days);
  if (parsed.getDay() === 6) parsed.setDate(parsed.getDate() + (days > 0 ? 2 : -1));
  if (parsed.getDay() === 0) parsed.setDate(parsed.getDate() + (days > 0 ? 1 : -2));
  requestDate(localDateString(parsed));
}

function goToday() {
  const today = localDateString(new Date());
  if (today === date.value) return;
  requestDate(today);
}

function retryConnection() {
  window.dispatchEvent(new CustomEvent('guardies:retry-connection'));
}

function resolveConflict(choice) {
  window.dispatchEvent(new CustomEvent('guardies:resolve-conflict', { detail: { choice } }));
}

function openUnclosedDay(unclosedDate) {
  requestDate(unclosedDate);
}

function preparePrintDensity() {
  const rows = document.querySelectorAll('#coverage-list .coverage-item:not(.not-completed)').length;
  const patioCards = document.querySelectorAll('#coverage-list .pati-zone-card').length;
  const comments = Array.from(document.querySelectorAll('#coverage-list [data-comment-print]'))
    .reduce((total, node) => total + String(node.textContent || '').length, 0);
  const load = rows + Math.ceil(patioCards / 4) + Math.ceil(comments / 180);
  document.documentElement.dataset.guardiesPrintDensity = load > 50 ? 'maximum' : load > 32 ? 'compact' : 'normal';
}

function clearPrintDensity() {
  delete document.documentElement.dataset.guardiesPrintDensity;
}

onMounted(() => {
  window.addEventListener('beforeprint', preparePrintDensity);
  window.addEventListener('afterprint', clearPrintDensity);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', preparePrintDensity);
  window.removeEventListener('afterprint', clearPrintDensity);
});

function printCoverage() {
  preparePrintDensity();
  window.print();
}

function clearDay() {
  if (!window.confirm('Vols netejar totes les absències i sortides d’aquest dia?')) return;
  store.clearAbsencePlan();
  store.clearGroupsOut();
  window.dispatchEvent(new CustomEvent('guardies:day-edited'));
}

const statusAction = computed(() => {
  if (dayStatus.value === 'closed') return { action: 'reopen', label: 'Reobre', className: 'ghost' };
  if (dayStatus.value === 'published') return { action: 'close', label: 'Tanca jornada', className: 'close-day' };
  return { action: 'publish', label: 'Publica', className: '' };
});

const statusActionDisabled = computed(() => (
  dayPersistenceStatus.value === 'saving'
));

function changeStatus(action) {
  window.dispatchEvent(new CustomEvent('guardies:day-action', { detail: { action } }));
}
</script>

<template>
  <div class="work-header-stack no-print">
    <div v-if="canWrite && dayConflict" class="day-conflict" role="alert">
      <span>Canvis pendents de resoldre</span>
      <button type="button" :disabled="conflictRemoteClosed" @click="resolveConflict('local')">Conserva la meva versió</button>
      <button type="button" class="ghost" @click="resolveConflict('remote')">Carrega la compartida</button>
    </div>
    <p v-if="!teacherView && canWrite && unclosedDays.length" class="unclosed-days-warning" role="status">
      <strong>Dies no tancats:</strong>
      <button
        v-for="unclosedDate in unclosedDays"
        :key="unclosedDate"
        type="button"
        class="unclosed-day-link"
        :aria-label="`Obre el dia ${formatShortDate(unclosedDate)}`"
        @click="openUnclosedDay(unclosedDate)"
      >{{ formatShortDate(unclosedDate) }}</button>
    </p>
    <header class="work-header" :class="{ 'teacher-date-header': teacherView }">
    <div v-if="!teacherView" class="work-title">
      <p class="kicker">Control diari</p>
      <h1>Guàrdies</h1>
    </div>

    <div class="date-dock">
      <div class="date-field">
        <label for="date-input">{{ teacherView ? 'Dia de consulta' : 'Dia de treball' }}</label>
        <div class="date-input-row">
          <button type="button" class="date-arrow" aria-label="Dia anterior" title="Dia anterior" @click="shiftDate(-1)">←</button>
          <input id="date-input" type="date" :value="date" @change="onDateChange" />
          <button type="button" class="date-arrow" aria-label="Dia següent" title="Dia següent" @click="shiftDate(1)">→</button>
        </div>
      </div>
      <div v-if="!teacherView" id="date-label" class="date-summary-card">
        <span>Dia preparat</span>
        <strong>{{ formatDate(date) }}</strong>
        <em v-if="!['1', '2', '3', '4', '5'].includes(xmlDay)">Dia no lectiu</em>
      </div>
      <button v-if="!teacherView" id="today-info" type="button" class="date-summary-card today-info" title="Ves a avui" @click="goToday">
        <span>Avui</span>
        <strong>{{ formatDate(localDateString(new Date())) }}</strong>
      </button>
    </div>

    <div v-if="!teacherView" class="day-command-bar">
      <div class="day-summary" aria-live="polite">
        <span class="pill sync-pill" :class="syncClass">{{ syncLabel }}</span>
        <span class="day-count">{{ assignedAbsences }}/{{ selectedAbsences.length }} cobertes</span>
        <span class="last-sync">{{ lastSyncLabel }}</span>
      </div>
      <button v-if="persistenceStatus === 'error'" id="retry-connection" type="button" class="ghost" @click="retryConnection">Reintenta ara</button>
      <button id="print-coverage" type="button" class="ghost" :disabled="dayPersistenceStatus === 'loading'" @click="printCoverage">Imprimeix A3</button>
      <button
        v-if="canWrite"
        id="day-status-action"
        type="button"
        :class="statusAction.className"
        :disabled="statusActionDisabled"
        @click="changeStatus(statusAction.action)"
      >{{ statusAction.label }}</button>
      <button
        v-if="canWrite && dayStatus === 'published'"
        id="day-unpublish-action"
        type="button"
        class="ghost"
        :disabled="statusActionDisabled"
        @click="changeStatus('unpublish')"
      >Despublica</button>
      <button v-if="canWrite" id="clear-day-list" type="button" class="ghost" :disabled="dayStatus === 'closed' || !selectedAbsences.length" @click="clearDay">Neteja dia</button>
    </div>
    </header>
  </div>
</template>
