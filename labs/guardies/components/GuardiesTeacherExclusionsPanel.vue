<script setup>
import { computed, ref } from 'vue';
import { saveGuardiesExcludedTeachers } from '../../../src/services/guardiesStorage.js';
import { useGuardiesStore } from '../stores/guardies.js';

const state = useGuardiesStore();
const query = ref('');
const saving = ref(new Set());
const error = ref('');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const rows = computed(() => {
  const directoryByCode = new Map(state.teacherDirectory
    .map((teacher) => [normalize(teacher.codiUntis || teacher.id), teacher]));
  const combined = state.allProfessorOptions
    .filter((teacher) => teacher.name && normalize(teacher.name) !== normalize(teacher.short || teacher.placa))
    .map((teacher) => {
      const code = normalize(teacher.short || teacher.placa);
      const directory = directoryByCode.get(code);
      return {
        teacherId: teacher.placa,
        code: teacher.short || teacher.placa,
        name: directory?.name || teacher.name || teacher.label,
        email: directory?.email || '',
      };
    });
  const term = normalize(query.value);
  return combined
    .filter((teacher) => !term || normalize(`${teacher.name} ${teacher.email} ${teacher.code}`).includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'ca', { numeric: true }));
});

const excludedCount = computed(() => state.excludedTeacherIds.size);

function isRowExcluded(teacher) {
  return state.excludedTeacherIds.has(teacher.teacherId)
    || state.excludedTeacherIds.has(teacher.code);
}

async function setExcluded(teacher, excluded) {
  const previous = new Set(state.excludedTeacherIds);
  const next = new Set(previous);
  next.delete(teacher.teacherId);
  next.delete(teacher.code);
  if (excluded) next.add(teacher.teacherId);
  state.excludedTeacherIds = next;
  saving.value = new Set(saving.value).add(teacher.teacherId);
  error.value = '';
  window.dispatchEvent(new CustomEvent('guardies:exclusions-updated'));
  try {
    const saved = await saveGuardiesExcludedTeachers(state.courseId, Array.from(next));
    state.excludedTeacherIds = new Set(saved);
  } catch (cause) {
    state.excludedTeacherIds = previous;
    error.value = cause?.message || String(cause);
    window.dispatchEvent(new CustomEvent('guardies:exclusions-updated'));
  } finally {
    const pending = new Set(saving.value);
    pending.delete(teacher.teacherId);
    saving.value = pending;
  }
}
</script>

<template>
  <details id="teacher-exclusions-panel" class="admin-panel teacher-exclusions-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">🎓</span>
        <strong>Professorat d’FP</strong>
      </span>
      <span class="cache-info">{{ excludedCount }} marcats</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block">
        <div class="teacher-exclusions-toolbar">
          <label for="teacher-exclusions-search">Professorat</label>
          <input id="teacher-exclusions-search" v-model="query" type="search" placeholder="Nom, correu o codi…" />
        </div>
        <div class="teacher-exclusions-table" role="table" aria-label="Professorat d’FP">
          <div class="teacher-exclusions-row teacher-exclusions-columns" role="row">
            <span role="columnheader">Nom</span>
            <span role="columnheader">Correu</span>
            <span role="columnheader">FP</span>
          </div>
          <label v-for="teacher in rows" :key="teacher.teacherId" class="teacher-exclusions-row" role="row">
            <span role="cell"><strong>{{ teacher.name }}</strong><small>{{ teacher.code }}</small></span>
            <span role="cell" class="teacher-email">{{ teacher.email || 'Sense correu' }}</span>
            <span role="cell" class="teacher-exclusion-check">
              <input
                type="checkbox"
                :checked="isRowExcluded(teacher)"
                :disabled="saving.has(teacher.teacherId)"
                :aria-label="`${teacher.name} és d’FP`"
                @change="setExcluded(teacher, $event.target.checked)"
              />
            </span>
          </label>
        </div>
        <p v-if="error" class="guard-count-error" role="alert">{{ error }}</p>
      </section>
    </div>
  </details>
</template>
