<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey } from '../../../src/modules/guardies/domain/workflow.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { guardCounts, professorOptions, courseName, viewerName, sessions, guardiaCodes } = storeToRefs(store);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameSignature(value) {
  return normalize(value).split(' ').filter((token) => token.length > 1).sort().join('|');
}

function publicTeacherName(teacher) {
  const name = String(teacher.name || '').trim();
  const short = String(teacher.short || '').trim();
  if (name && normalize(name) !== normalize(short || teacher.placa)) return name;

  const label = String(teacher.label || '').trim();
  const suffix = short ? ` · ${short}` : '';
  if (suffix && label.endsWith(suffix)) return label.slice(0, -suffix.length).trim();
  if (label && normalize(label) !== normalize(short || teacher.placa)) return label;
  return `(${short || label || teacher.placa})`;
}

const days = [
  { key: '1', label: 'Dilluns' },
  { key: '2', label: 'Dimarts' },
  { key: '3', label: 'Dimecres' },
  { key: '4', label: 'Dijous' },
  { key: '5', label: 'Divendres' },
];

const guardMatrix = computed(() => {
  const teachers = new Map(professorOptions.value.map((teacher) => [teacher.placa, publicTeacherName(teacher)]));
  const viewer = nameSignature(viewerName.value);
  const hours = Array.from(new Set(sessions.value
    .map((session) => session.hora)
    .filter((hour) => hour && hour !== 'PATI')))
    .sort((a, b) => String(a).localeCompare(String(b), 'ca', { numeric: true }));
  const teachersBySlot = new Map();

  sessions.value.filter((session) => (
    session.dia >= '1' && session.dia <= '5'
    && session.hora !== 'PATI'
    && (session.activitatEsGuardiaGeneral || guardiaCodes.value.has(session.activitat))
    && teachers.has(session.placa)
  )).forEach((session) => {
    const key = guardSlotKey(session.dia, session.hora);
    if (!teachersBySlot.has(key)) teachersBySlot.set(key, new Set());
    teachersBySlot.get(key).add(session.placa);
  });

  return hours.map((hour, index) => ({
    hour,
    period: `${index + 1}a`,
    cells: days.map((day) => {
      const key = guardSlotKey(day.key, hour);
      return {
        key,
        teachers: Array.from(teachersBySlot.get(key) || [], (teacherId) => {
          const label = teachers.get(teacherId) || teacherId;
          return {
            teacherId,
            label,
            count: guardCountForSlot(guardCounts.value.get(teacherId), key),
            mine: Boolean(viewer && viewer === nameSignature(label)),
          };
        }).sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true })),
      };
    }),
  }));
});
</script>

<template>
  <section class="teacher-stats-panel no-print" aria-labelledby="teacher-stats-title">
    <header class="teacher-stats-head">
      <div>
        <p class="kicker">Curs {{ courseName }}</p>
        <h2 id="teacher-stats-title">Recompte de guàrdies per hores</h2>
      </div>
    </header>

    <div v-if="guardMatrix.length" class="guard-matrix-frame">
      <div class="guard-matrix" role="table" aria-label="Professorat de G i cobertures realitzades per dia i hora">
        <div class="guard-matrix-row guard-matrix-columns" role="row">
          <span class="guard-matrix-corner" role="columnheader">Hora</span>
          <strong v-for="day in days" :key="day.key" role="columnheader">{{ day.label }}</strong>
        </div>

        <div v-for="row in guardMatrix" :key="row.hour" class="guard-matrix-row" :data-roster-hour="row.hour" role="row">
          <div class="guard-matrix-hour" role="rowheader">
            <strong>{{ row.period }}</strong>
            <small>{{ row.hour }}</small>
          </div>
          <div
            v-for="cell in row.cells"
            :key="cell.key"
            class="guard-matrix-cell"
            :data-roster-slot="cell.key"
            role="cell"
          >
            <article
              v-for="teacher in cell.teachers"
              :key="teacher.teacherId"
              class="guard-roster-teacher"
              :class="{ 'is-mine': teacher.mine }"
              :data-roster-teacher="teacher.teacherId"
            >
              <span>{{ teacher.label }}</span>
              <b data-roster-count :aria-label="`${teacher.count} guàrdies realitzades en aquesta hora`">{{ teacher.count }}</b>
            </article>
            <span v-if="!cell.teachers.length" class="guard-matrix-empty">—</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty-small">No hi ha hores de guàrdia configurades.</div>
  </section>
</template>
