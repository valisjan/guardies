<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { date, absencies, dayStatus, dayPersistenceStatus, canWrite, teacherView, unclosedDays } = storeToRefs(store);

const xmlDay = computed(() => {
  if (!date.value) return '';
  const parsed = new Date(`${date.value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : String(parsed.getDay());
});

const selectedAbsences = computed(() => (
  Array.from(absencies.value.values()).filter((item) => item.dia === xmlDay.value)
));

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
  store.changeDate(event.target.value);
  window.dispatchEvent(new CustomEvent('guardies:legacy-render', { detail: { reloadDay: true } }));
}

function shiftDate(days) {
  if (!date.value) return;
  const parsed = new Date(`${date.value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  parsed.setDate(parsed.getDate() + days);
  store.changeDate(localDateString(parsed));
  window.dispatchEvent(new CustomEvent('guardies:legacy-render', { detail: { reloadDay: true } }));
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
  store.clearAbsencePlan();
  store.clearGroupsOut();
  window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
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
    <p v-if="!teacherView && canWrite && unclosedDays.length" class="unclosed-days-warning" role="status">
      <strong>Dies no tancats:</strong>
      {{ unclosedDays.map(formatShortDate).join(' · ') }}
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
      <div v-if="!teacherView" id="today-info" class="date-summary-card today-info">
        <span>Avui</span>
        <strong>{{ formatDate(localDateString(new Date())) }}</strong>
      </div>
    </div>

    <div v-if="!teacherView" class="day-command-bar">
      <button id="print-coverage" type="button" class="ghost" :disabled="!selectedAbsences.length" @click="printCoverage">Imprimeix A3</button>
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
