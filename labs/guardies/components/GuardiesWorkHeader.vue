<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import GuardiesDayHistory from './GuardiesDayHistory.vue';

const historyOpen = ref(false);

const store = useGuardiesStore();
const {
  date, absencies, dayStatus, dayPersistenceStatus,
  persistenceStatus, canWrite, teacherView, unclosedDays,
  dayConflict, conflictRemoteClosed, coverageSummary, autoSavePaused, closingDays,
  unmatchedAbsences,
} = storeToRefs(store);

// Absències desades que l'horari carregat no conté: es conserven i s'avisa.
const unmatchedList = computed(() => Array.from(unmatchedAbsences.value, ([id, entry]) => ({
  id,
  teacher: entry.teacher || id.split('|')[0],
  hour: entry.hour || id.split('|')[2] || '',
  coveredBy: entry.coveredBy || '',
  comment: entry.comment || '',
})));

function discardUnmatched() {
  const count = unmatchedList.value.length;
  const message = count === 1
    ? 'Vols descartar l’absència que no encaixa amb l’horari? No es podrà recuperar.'
    : `Vols descartar les ${count} absències que no encaixen amb l’horari? No es podran recuperar.`;
  if (!window.confirm(message)) return;
  store.discardUnmatchedAbsences();
  window.dispatchEvent(new CustomEvent('guardies:day-edited'));
}

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

// Part de les absències que ja tenen qui les cobreixi (barra de progrés del resum).
const coverageTotal = computed(() => coverageSummary.value.open + coverageSummary.value.covered);
const coveragePercent = computed(() => (
  coverageTotal.value ? Math.round((coverageSummary.value.covered / coverageTotal.value) * 100) : 0
));

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

function closeUnclosedDays() {
  window.dispatchEvent(new CustomEvent('guardies:close-days', { detail: { dates: unclosedDays.value } }));
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
    <div v-if="canWrite && unmatchedList.length" class="unmatched-absences" role="alert">
      <p v-if="unmatchedList.length === 1">
        <strong>Una absència desada no surt al full</strong> perquè no encaixa amb l’horari carregat.
        Es conserva fins que la descartis: torna-la a marcar si encara cal.
      </p>
      <p v-else>
        <strong>{{ unmatchedList.length }} absències desades no surten al full</strong> perquè no encaixen amb l’horari carregat.
        Es conserven fins que les descartis: torna-les a marcar si encara cal.
      </p>
      <ul>
        <li v-for="item in unmatchedList" :key="item.id">
          <strong>{{ item.teacher }}</strong> · {{ item.hour }}<template v-if="item.coveredBy"> · cobreix {{ item.coveredBy }}</template><template v-if="item.comment"> · «{{ item.comment }}»</template>
        </li>
      </ul>
      <button type="button" :disabled="dayStatus === 'closed'" @click="discardUnmatched">{{ unmatchedList.length === 1 ? 'Descarta-la' : 'Descarta-les' }}</button>
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
      <button type="button" class="unclosed-close-all" :disabled="closingDays" @click="closeUnclosedDays">
        {{ closingDays ? 'Tancant…' : unclosedDays.length === 1 ? 'Tanca-la' : 'Tanca-les totes' }}
      </button>
    </p>
    <header v-if="!teacherView" class="work-header">
    <div class="work-title">
      <h1>{{ headingDate }}</h1>
      <div class="work-title-meta">
        <span class="day-status-badge" :class="`is-${dayStatus}`">{{ dayStatusLabel }}</span>
        <em v-if="nonTeachingDay" class="non-teaching-note">Dia no lectiu</em>
        <button v-if="canWrite" id="day-history-toggle" type="button" class="day-history-toggle" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">Historial</button>
      </div>
    </div>

    <div class="day-kpis" role="group" aria-label="Resum de la jornada">
      <div class="day-kpi" :class="{ 'is-open': coverageSummary.open > 0 }">
        <strong :key="coverageSummary.open">{{ coverageSummary.open }}</strong>
        <span>sense cobrir</span>
      </div>
      <div class="day-kpi" :class="{ 'is-covered': coverageSummary.covered > 0 }">
        <strong :key="coverageSummary.covered">{{ coverageSummary.covered }}</strong>
        <span>{{ coverageSummary.covered === 1 ? 'coberta' : 'cobertes' }}</span>
      </div>
      <div class="day-kpi">
        <strong :key="coverageSummary.outings">{{ coverageSummary.outings }}</strong>
        <span>{{ coverageSummary.outings === 1 ? 'sortida' : 'sortides' }}</span>
      </div>
      <div
        v-if="coverageTotal"
        class="day-progress"
        :class="{ 'is-complete': coveragePercent === 100 }"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="coveragePercent"
        :aria-label="`${coverageSummary.covered} de ${coverageTotal} absències cobertes`"
      >
        <span :style="{ width: `${coveragePercent}%` }"></span>
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
    <GuardiesDayHistory v-if="canWrite && !teacherView && historyOpen" @close="historyOpen = false" />
  </div>
</template>
