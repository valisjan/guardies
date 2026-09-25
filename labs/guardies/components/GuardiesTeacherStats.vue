<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey } from '../../../src/modules/guardies/domain/workflow.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { guardCounts, guardHistory, professorOptions, courseName, viewerName, sessions, guardiaCodes, teacherStatsStatus } = storeToRefs(store);

function retryStats() {
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
}

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

function historyForTeacher(teacher) {
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
    if (!aliases.has(normalize(teacherId))) return;
    Object.entries(dates && typeof dates === 'object' ? dates : {}).forEach(([date, groups]) => {
      const current = merged.get(date) || [];
      merged.set(date, Array.from(new Set([...current, ...(Array.isArray(groups) ? groups : [])])));
    });
  });
  return Array.from(merged.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, groups]) => ({ date, groups: Array.isArray(groups) ? groups : [] }));
}

function historyText(teacher) {
  const entries = historyForTeacher(teacher);
  if (!entries.length) return '';
  const lines = entries.map(({ date, groups }) => {
    const formatted = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
    return `${formatted} · ${groups.length ? groups.join(' · ') : '—'}`;
  });
  return [`${entries.length} ${entries.length === 1 ? 'guàrdia' : 'guàrdies'}`, ...lines].join('\n');
}

const historyTextByTeacher = computed(() => new Map(
  professorOptions.value.map((teacher) => [teacher.placa, historyText(teacher)]),
));
</script>

<template>
  <section class="teacher-stats-panel no-print" aria-labelledby="teacher-stats-title">
    <p v-if="teacherStatsStatus === 'loading'" role="status">Carregant recompte…</p>
    <button v-if="teacherStatsStatus === 'error'" type="button" @click="retryStats">Reintenta</button>
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
              :class="[`heat-${teacher.heat}`, { 'is-mine': teacher.mine }]"
              :data-roster-teacher="teacher.teacherId"
              :title="historyTextByTeacher.get(teacher.teacherId) || ''"
              :aria-label="`${teacher.label}${historyTextByTeacher.get(teacher.teacherId) ? ` · ${historyTextByTeacher.get(teacher.teacherId)}` : ''}`"
              role="button"
              tabindex="0"
            >
              <span>{{ teacher.label }}</span>
              <b data-roster-count :aria-label="`${teacher.count} guàrdies realitzades en aquesta hora`">{{ teacher.count }}</b>
              <span v-if="historyTextByTeacher.get(teacher.teacherId)" class="guard-history-tooltip" role="tooltip">{{ historyTextByTeacher.get(teacher.teacherId) }}</span>
            </article>
            <span v-if="!cell.teachers.length" class="guard-matrix-empty">—</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!guardMatrix.length" class="empty-small">No hi ha hores de guàrdia configurades.</div>
  </section>
</template>
