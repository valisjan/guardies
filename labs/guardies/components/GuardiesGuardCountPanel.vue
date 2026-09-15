<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey, normalizeGuardCount } from '../../../src/modules/guardies/domain/workflow.js';
import { resetGuardiesCourseData, setGuardiesTeacherCount } from '../../../src/services/guardiesStorage.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { courseId, guardCounts, professorOptions, sessions, guardiaCodes } = storeToRefs(store);
const query = ref('');
const selectedSlot = ref('');
const saving = ref(new Set());
const saved = ref('');
const error = ref('');
const resetting = ref(false);
const confirmingReset = ref(false);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const dayLabels = { 1: 'Dilluns', 2: 'Dimarts', 3: 'Dimecres', 4: 'Dijous', 5: 'Divendres' };

const slotOptions = computed(() => {
  const hours = Array.from(new Set(sessions.value.map((session) => session.hora).filter((hour) => hour && hour !== 'PATI')))
    .sort((a, b) => String(a).localeCompare(String(b), 'ca', { numeric: true }));
  const hourNumber = new Map(hours.map((hour, index) => [hour, index + 1]));
  const slots = new Map();
  sessions.value.filter((session) => (
    session.dia >= '1' && session.dia <= '5'
    && session.hora !== 'PATI'
    && (session.activitatEsGuardiaGeneral || guardiaCodes.value.has(session.activitat))
  )).forEach((session) => {
    const key = guardSlotKey(session.dia, session.hora);
    slots.set(key, {
      key,
      day: session.dia,
      hour: session.hora,
      label: `${dayLabels[session.dia]} · ${hourNumber.get(session.hora)}a · ${session.hora}`,
    });
  });
  return Array.from(slots.values()).sort((a, b) => (
    Number(a.day) - Number(b.day)
    || String(a.hour).localeCompare(String(b.hour), 'ca', { numeric: true })
  ));
});
const selectedSlotLabel = computed(() => (
  slotOptions.value.find((slot) => slot.key === selectedSlot.value)?.label || 'la franja seleccionada'
));

watch(slotOptions, (options) => {
  if (!options.some((option) => option.key === selectedSlot.value)) selectedSlot.value = options[0]?.key || '';
}, { immediate: true });

const rows = computed(() => {
  const term = normalize(query.value).trim();
  return professorOptions.value
    .map((teacher) => ({
      teacherId: teacher.placa,
      label: teacher.label,
      count: normalizeGuardCount(guardCounts.value.get(teacher.placa)),
      guardInSlot: guardCountForSlot(guardCounts.value.get(teacher.placa), selectedSlot.value),
    }))
    .filter((row) => !term || normalize(`${row.label} ${row.teacherId}`).includes(term))
    .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));
});

async function updateCount(teacherId, source, rawValue) {
  const count = Math.max(0, Math.trunc(Number(rawValue) || 0));
  saving.value = new Set(saving.value).add(teacherId);
  saved.value = '';
  error.value = '';
  try {
    const next = await setGuardiesTeacherCount(
      courseId.value,
      teacherId,
      source,
      count,
      source === 'guard' ? selectedSlot.value : '',
    );
    guardCounts.value = new Map(Object.entries(next.counts || {}));
    saved.value = `${teacherId}:${source}:${source === 'guard' ? selectedSlot.value : ''}`;
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    const nextSaving = new Set(saving.value);
    nextSaving.delete(teacherId);
    saving.value = nextSaving;
  }
}

async function resetCourse() {
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    return;
  }
  resetting.value = true;
  error.value = '';
  try {
    await resetGuardiesCourseData(courseId.value);
    window.location.reload();
  } catch (cause) {
    error.value = cause?.message || String(cause);
    resetting.value = false;
  }
}
</script>

<template>
  <details id="guard-counts-panel" class="admin-panel guard-counts-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">#</span>
        <strong>Recompte de guàrdies</strong>
      </span>
      <span class="cache-info">{{ professorOptions.length }} professors</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block">
        <div class="guard-count-toolbar">
          <label for="guard-count-search">Professorat</label>
          <input id="guard-count-search" v-model="query" type="search" placeholder="Nom o codi…" />
          <label for="guard-count-slot">Franja de G</label>
          <select id="guard-count-slot" v-model="selectedSlot" :disabled="!slotOptions.length">
            <option v-for="slot in slotOptions" :key="slot.key" :value="slot.key">{{ slot.label }}</option>
          </select>
        </div>
        <div class="guard-count-table" role="table" aria-label="Recompte manual de guàrdies">
          <div class="guard-count-row guard-count-columns" role="row">
            <span role="columnheader">Professorat</span>
            <span role="columnheader">Alliberat · curs</span>
            <span role="columnheader">G · franja</span>
          </div>
          <div v-for="row in rows" :key="row.teacherId" class="guard-count-row" role="row">
            <strong role="cell">{{ row.label }}</strong>
            <label role="cell" :for="`released-count-${row.teacherId}`">
              <input
                :id="`released-count-${row.teacherId}`"
                type="number"
                min="0"
                step="1"
                :value="row.count.released"
                :disabled="saving.has(row.teacherId)"
                :aria-label="`Guàrdies com a alliberat de ${row.label}`"
                @change="updateCount(row.teacherId, 'released', $event.target.value)"
              />
              <small v-if="saved === `${row.teacherId}:released:`">Desat</small>
            </label>
            <label role="cell" :for="`guard-count-${row.teacherId}-${selectedSlot}`">
              <input
                :id="`guard-count-${row.teacherId}-${selectedSlot}`"
                type="number"
                min="0"
                step="1"
                :value="row.guardInSlot"
                :disabled="saving.has(row.teacherId)"
                :aria-label="`Guàrdies G de ${row.label} en ${selectedSlotLabel}`"
                @change="updateCount(row.teacherId, 'guard', $event.target.value)"
              />
              <small v-if="saved === `${row.teacherId}:guard:${selectedSlot}`">Desat</small>
            </label>
          </div>
        </div>
        <p v-if="error" class="guard-count-error" role="alert">{{ error }}</p>
        <button id="reset-guardies-course" type="button" class="guard-reset-button" :disabled="resetting" @click="resetCourse">
          {{ resetting ? 'Reiniciant…' : confirmingReset ? `Confirma el reinici de ${courseId}` : 'Reinicia jornades i recomptes' }}
        </button>
      </section>
    </div>
  </details>
</template>
