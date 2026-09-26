<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const {
  date, absencies, dayStatus, dayPersistenceStatus,
  persistenceStatus, canWrite, teacherView, unclosedDays,
  dayConflict, conflictRemoteClosed, coverageSummary, autoSavePaused,
} = storeToRefs(store);

const xmlDay = computed(() => {
  if (!date.value) return '';
  const parsed = new Date(`${date.value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : String(parsed.getDay());
});

const selectedAbsences = computed(() => (
  Array.from(absencies.value.values()).filter((item) => item.dia === xmlDay.value)
));

const headingFormatter = new Intl.DateTimeFormat('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' });

// La data i la sincronització són a la barra superior; aquí, el dia com a títol.
const headingDate = computed(() => {
  const parsed = new Date(`${date.value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Sense data';
  const text = headingFormatter.format(parsed);
  return text.charAt(0).toUpperCase() + text.slice(1);
});

const nonTeachingDay = computed(() => !['1', '2', '3', '4', '5'].includes(xmlDay.value));

const dayStatusLabel = computed(() => ({
  published: 'Publicada',
  closed: 'Tancada',
}[dayStatus.value] || 'Esborrany'));

function formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

function requestDate(value) {
  window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: value } }));
}

function retryConnection() {
  window.dispatchEvent(new CustomEvent('guardies:retry-connection'));
}

function resumeAutoSave() {
  window.dispatchEvent(new CustomEvent('guardies:resume-autosave'));
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
    <div v-if="canWrite && autoSavePaused" class="day-conflict autosave-paused" role="alert">
      <span>Guardat automàtic aturat</span>
      <button type="button" @click="resumeAutoSave">Reprèn el guardat</button>
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
    <header v-if="!teacherView" class="work-header">
    <div class="work-title">
      <h1>{{ headingDate }}</h1>
      <div class="work-title-meta">
        <span class="day-status-badge" :class="`is-${dayStatus}`">{{ dayStatusLabel }}</span>
        <em v-if="nonTeachingDay" class="non-teaching-note">Dia no lectiu</em>
      </div>
    </div>

    <div class="day-kpis" role="group" aria-label="Resum de la jornada">
      <div class="day-kpi" :class="{ 'is-open': coverageSummary.open > 0 }">
        <strong>{{ coverageSummary.open }}</strong>
        <span>sense cobrir</span>
      </div>
      <div class="day-kpi" :class="{ 'is-covered': coverageSummary.covered > 0 }">
        <strong>{{ coverageSummary.covered }}</strong>
        <span>{{ coverageSummary.covered === 1 ? 'coberta' : 'cobertes' }}</span>
      </div>
      <div class="day-kpi">
        <strong>{{ coverageSummary.outings }}</strong>
        <span>{{ coverageSummary.outings === 1 ? 'sortida' : 'sortides' }}</span>
      </div>
    </div>

    <div class="day-command-bar">
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
