<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { date, dayStatus, canWrite, grupsFora } = storeToRefs(store);
const absenceFrom = ref(date.value);
const absenceTo = ref(date.value);
const outingFrom = ref(date.value);
const outingTo = ref(date.value);
const absenceFeedback = ref('');
const absenceFeedbackKind = ref('');
const outingFeedback = ref('');
const outingFeedbackKind = ref('');

const canCopyOuting = computed(() => (
  Boolean(outingFrom.value && outingTo.value)
  && outingFrom.value <= outingTo.value
  && (outingFrom.value !== date.value || outingTo.value !== date.value)
  && grupsFora.value.size > 0
));

watch(date, (value) => {
  absenceFrom.value = value;
  absenceTo.value = value;
  outingFrom.value = value;
  outingTo.value = value;
  absenceFeedback.value = '';
  absenceFeedbackKind.value = '';
  outingFeedback.value = '';
  outingFeedbackKind.value = '';
});

function applyAbsenceRange() {
  absenceFeedback.value = 'Aplicant l’interval...';
  absenceFeedbackKind.value = '';
  window.dispatchEvent(new CustomEvent('guardies:apply-absence-range', {
    detail: { from: absenceFrom.value, to: absenceTo.value },
  }));
}

function handleAbsenceRangeResult(event) {
  absenceFeedback.value = event.detail?.message || '';
  absenceFeedbackKind.value = event.detail?.ok ? 'success' : 'error';
}

function applyOutingRange() {
  outingFeedback.value = 'Copiant la sortida...';
  outingFeedbackKind.value = '';
  window.dispatchEvent(new CustomEvent('guardies:apply-outing-range', {
    detail: { from: outingFrom.value, to: outingTo.value },
  }));
}

function handleOutingRangeResult(event) {
  outingFeedback.value = event.detail?.message || '';
  outingFeedbackKind.value = event.detail?.ok ? 'success' : 'error';
}

onMounted(() => {
  window.addEventListener('guardies:absence-range-result', handleAbsenceRangeResult);
  window.addEventListener('guardies:outing-range-result', handleOutingRangeResult);
});
onBeforeUnmount(() => {
  window.removeEventListener('guardies:absence-range-result', handleAbsenceRangeResult);
  window.removeEventListener('guardies:outing-range-result', handleOutingRangeResult);
});
</script>

<template>
  <aside class="entry-panel no-print">
    <div class="entry-head">
      <div>
        <p class="kicker">Entrada</p>
        <h2>Incidències</h2>
      </div>
      <div class="mode-tabs" role="tablist" aria-label="Tipus d'incidència">
        <button
          type="button"
          class="mode-tab active"
          role="tab"
          aria-selected="true"
          aria-controls="professor-mode"
          data-intake-mode="professor"
        >
          Professor/a
        </button>
        <button
          type="button"
          class="mode-tab"
          role="tab"
          aria-selected="false"
          aria-controls="group-mode"
          data-intake-mode="group"
        >
          Grup de sortida
        </button>
      </div>
    </div>

    <section id="professor-mode" class="mode-panel" role="tabpanel" data-mode-panel="professor">
      <div class="teacher-search">
        <label for="professor-search">Professor/a absent</label>
        <input
          id="professor-search"
          type="search"
          autocomplete="off"
          placeholder="Escriu i prem Enter..."
          role="combobox"
          aria-autocomplete="list"
          aria-controls="professor-results"
          aria-expanded="false"
        />
        <select id="professor-select" class="hidden"></select>
        <strong id="selected-professor-label" class="hidden">Cap professor</strong>
        <div id="professor-results" class="search-results" role="listbox" aria-label="Resultats de professorat"></div>
      </div>

      <div class="mode-panel-head">
        <h3 id="schedule-title">Sessions del professor</h3>
        <div class="schedule-actions">
          <button id="add-all-hours" type="button" class="ghost">Tot el dia</button>
          <button id="clear-missing" type="button" class="ghost">Neteja</button>
        </div>
      </div>
      <div id="schedule-grid" class="schedule-grid"></div>
      <div class="range-builder">
        <div class="range-copy">
          <strong>Aplica a un interval</strong>
        </div>
        <label>Des de <input v-model="absenceFrom" type="date" /></label>
        <label>Fins a <input v-model="absenceTo" type="date" /></label>
        <button type="button" :disabled="!canWrite || dayStatus === 'closed'" @click="applyAbsenceRange">Aplica interval</button>
        <p v-if="absenceFeedback" class="range-feedback" :class="`is-${absenceFeedbackKind}`" role="status" aria-live="polite">{{ absenceFeedback }}</p>
      </div>
    </section>

    <section id="group-mode" class="mode-panel hidden" role="tabpanel" data-mode-panel="group">
      <div class="group-picker">
        <label for="group-search">Grup de sortida</label>
        <div class="group-search-row">
          <select id="group-search">
            <option value="">Selecciona un grup per afegir-lo...</option>
          </select>
        </div>
        <div class="outing-range">
          <div class="range-copy">
            <strong>Copia aquesta sortida a altres dies</strong>
          </div>
          <label for="outing-from">Des de <input id="outing-from" v-model="outingFrom" type="date" /></label>
          <label for="outing-to">Fins a <input id="outing-to" v-model="outingTo" type="date" /></label>
          <button type="button" class="ghost" :disabled="!canWrite || dayStatus === 'closed' || !canCopyOuting" @click="applyOutingRange">Copia als dies de l’interval</button>
          <p v-if="outingFeedback" class="range-feedback" :class="`is-${outingFeedbackKind}`" role="status" aria-live="polite">{{ outingFeedback }}</p>
        </div>
        <div class="group-selection-head">
          <span id="released-count" class="pill">0 professors</span>
          <button id="clear-groups" type="button" class="ghost">Treu tots</button>
        </div>
        <div id="selected-groups" class="selected-groups" aria-label="Grups seleccionats"></div>
      </div>

      <details class="released-disclosure">
        <summary>Professorat alliberat</summary>
        <div id="released-list" class="released-list"></div>
      </details>
    </section>
  </aside>
</template>
