<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey } from '../../../src/modules/guardies/domain/workflow.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { guardCounts, guardHistory, professorOptions, courseName, viewerName, sessions, guardiaCodes } = storeToRefs(store);
const selectedTeacherId = ref('');

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

function heatLevel(value, maximum) {
  const count = Number(value) || 0;
  if (!maximum || count <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / maximum) * 5)));
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

  const matrix = hours.map((hour, index) => ({
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
  const maximum = Math.max(0, ...matrix.flatMap((row) => row.cells.flatMap((cell) => (
    cell.teachers.map((teacher) => Number(teacher.count) || 0)
  ))));
  return matrix.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      teachers: cell.teachers.map((teacher) => ({
        ...teacher,
        heat: heatLevel(teacher.count, maximum),
      })),
    })),
  }));
});

const selectedTeacher = computed(() => {
  if (!selectedTeacherId.value) return null;
  return professorOptions.value.find((teacher) => teacher.placa === selectedTeacherId.value) || null;
});

const selectedHistory = computed(() => {
  const teacher = selectedTeacher.value;
  if (!teacher) return [];
  const aliases = new Set([
    teacher.placa,
    teacher.short,
    teacher.id,
    teacher.codiUntis,
    teacher.name,
    teacher.label,
  ].map(normalize).filter(Boolean));
  const merged = new Map();
  Object.entries(guardHistory.value || {}).forEach(([teacherId, dates]) => {
    if (teacherId !== selectedTeacherId.value && !aliases.has(normalize(teacherId))) return;
    Object.entries(dates && typeof dates === 'object' ? dates : {}).forEach(([date, groups]) => {
      const current = merged.get(date) || [];
      merged.set(date, Array.from(new Set([...current, ...(Array.isArray(groups) ? groups : [])])));
    });
  });
  return Array.from(merged.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, groups]) => ({ date, groups: Array.isArray(groups) ? groups : [] }));
});

function selectTeacher(teacherId) {
  selectedTeacherId.value = selectedTeacherId.value === teacherId ? '' : teacherId;
}
</script>

<template>
  <section class="teacher-stats-panel no-print" aria-labelledby="teacher-stats-title">
    <header class="teacher-stats-head">
      <div>
        <p class="kicker">Curs {{ courseName }}</p>
        <h2 id="teacher-stats-title">Recompte de guàrdies per hores</h2>
      </div>
    </header>

    <section v-if="selectedTeacher" class="guard-history guard-history-popover" aria-live="polite" aria-label="Historial de guàrdies del professor seleccionat">
      <header>
        <div>
          <span class="guard-history-kicker">Historial de guàrdies G</span>
          <strong>{{ selectedTeacher.label }}</strong>
        </div>
        <button type="button" class="ghost" @click="selectedTeacherId = ''">Tanca</button>
      </header>
      <p v-if="!selectedHistory.length" class="empty-small">No hi ha guardies G tancades per aquest professor.</p>
      <template v-else>
        <p class="guard-history-summary">{{ selectedHistory.length }} {{ selectedHistory.length === 1 ? 'jornada' : 'jornades' }} tancades</p>
        <ul>
          <li v-for="entry in selectedHistory" :key="entry.date">
            <time :datetime="entry.date">{{ new Intl.DateTimeFormat('ca-ES').format(new Date(`${entry.date}T12:00:00`)) }}</time>
            <span>{{ entry.groups.length ? entry.groups.join(' · ') : 'Grup no disponible' }}</span>
          </li>
        </ul>
      </template>
    </section>
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
              :class="[`heat-${teacher.heat}`, { 'is-mine': teacher.mine, selected: selectedTeacherId === teacher.teacherId }]"
              :data-roster-teacher="teacher.teacherId"
              :aria-pressed="selectedTeacherId === teacher.teacherId"
              role="button"
              tabindex="0"
              @click="selectTeacher(teacher.teacherId)"
              @keydown.enter="selectTeacher(teacher.teacherId)"
              @keydown.space.prevent="selectTeacher(teacher.teacherId)"
            >
              <span>{{ teacher.label }}</span>
              <b data-roster-count :aria-label="`${teacher.count} guàrdies realitzades en aquesta hora`">{{ teacher.count }}</b>
            </article>
            <span v-if="!cell.teachers.length" class="guard-matrix-empty">—</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!guardMatrix.length" class="empty-small">No hi ha hores de guàrdia configurades.</div>
  </section>
</template>
