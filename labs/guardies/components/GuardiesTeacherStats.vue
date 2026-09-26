<script setup>
import { computed, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey } from '../../../src/modules/guardies/domain/workflow.js';
import { slotHistoryEntries } from '../../../src/modules/guardies/domain/guard-history.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { guardCounts, guardHistory, professorOptions, courseName, viewerName, sessions, guardiaCodes, teacherStatsStatus } = storeToRefs(store);

function retryStats() {
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
}

// L'horari processat es conserva en memòria; només es deixa d'escoltar el recompte.
onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('guardies:release-teacher-stats'));
});

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

const dateFormatter = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Estructura estable: professorat de G per franja. No depèn dels recomptes,
// així que canviar guardCounts no la reconstrueix.
const guardLayout = computed(() => {
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
          return { teacherId, label, mine: Boolean(viewer && viewer === nameSignature(label)) };
        }).sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true })),
      };
    }),
  }));
});

const guardMatrix = computed(() => {
  const counts = guardCounts.value;
  let maximum = 0;
  const rows = guardLayout.value.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      teachers: cell.teachers.map((teacher) => {
        const count = guardCountForSlot(counts.get(teacher.teacherId), cell.key);
        maximum = Math.max(maximum, Number(count) || 0);
        return { ...teacher, count };
      }),
    })),
  }));
  rows.forEach((row) => row.cells.forEach((cell) => cell.teachers.forEach((teacher) => {
    teacher.heat = heatLevel(teacher.count, maximum);
  })));
  return rows;
});

// Historial indexat una sola vegada per nom normalitzat de professor.
const historyIndex = computed(() => {
  const index = new Map();
  Object.entries(guardHistory.value || {}).forEach(([teacherId, dates], order) => {
    const key = normalize(teacherId);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ order, dates: dates && typeof dates === 'object' ? dates : {} });
  });
  return index;
});

// Historial (data -> { "dia|hora": [grups] }) fusionat entre els àlies del professor.
function historyForTeacher(teacher, index) {
  const aliases = new Set([
    teacher.placa,
    teacher.short,
    teacher.id,
    teacher.codiUntis,
    teacher.name,
    teacher.label,
  ].map(normalize).filter(Boolean));
  const matches = new Set();
  aliases.forEach((alias) => {
    (index.get(alias) || []).forEach((entry) => matches.add(entry));
  });
  const merged = {};
  Array.from(matches).sort((left, right) => left.order - right.order).forEach(({ dates }) => {
    Object.entries(dates).forEach(([date, bySlot]) => {
      if (!bySlot || typeof bySlot !== 'object' || Array.isArray(bySlot)) return;
      merged[date] ||= {};
      Object.entries(bySlot).forEach(([slot, groups]) => {
        merged[date][slot] = Array.from(new Set([...(merged[date][slot] || []), ...(Array.isArray(groups) ? groups : [])]));
      });
    });
  });
  return merged;
}

function slotHistoryText(entries) {
  const lines = entries.map(({ date, groups }) => {
    const formatted = dateFormatter.format(new Date(`${date}T12:00:00`));
    return `${formatted} · ${groups.length ? groups.join(' · ') : '—'}`;
  });
  return [`${entries.length} ${entries.length === 1 ? 'guàrdia' : 'guàrdies'}`, ...lines].join('\n');
}

const historyKey = (teacherId, slot) => `${teacherId}|${slot}`;

// Text del tooltip per professor i franja: només les guàrdies d'aquella
// franja, igual que el recompte que es mostra a la cel·la.
const historyTextBySlot = computed(() => {
  const index = historyIndex.value;
  const texts = new Map();
  professorOptions.value.forEach((teacher) => {
    const merged = historyForTeacher(teacher, index);
    const slots = new Set(Object.values(merged).flatMap((bySlot) => Object.keys(bySlot)));
    slots.forEach((slot) => {
      const entries = slotHistoryEntries(merged, slot);
      if (entries.length) texts.set(historyKey(teacher.placa, slot), slotHistoryText(entries));
    });
  });
  return texts;
});

function historyTextFor(teacherId, slot) {
  return historyTextBySlot.value.get(historyKey(teacherId, slot)) || '';
}
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
              :aria-label="`${teacher.label}${historyTextFor(teacher.teacherId, cell.key) ? ` · ${historyTextFor(teacher.teacherId, cell.key)}` : ''}`"
              role="button"
              tabindex="0"
            >
              <span>{{ teacher.label }}</span>
              <b data-roster-count :aria-label="`${teacher.count} guàrdies realitzades en aquesta hora`">{{ teacher.count }}</b>
              <span v-if="historyTextFor(teacher.teacherId, cell.key)" class="guard-history-tooltip" role="tooltip">{{ historyTextFor(teacher.teacherId, cell.key) }}</span>
            </article>
            <span v-if="!cell.teachers.length" class="guard-matrix-empty">—</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!guardMatrix.length" class="empty-small">No hi ha hores de guàrdia configurades.</div>
  </section>
</template>
