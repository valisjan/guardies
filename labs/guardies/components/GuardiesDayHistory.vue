<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import { DAY_VERSION_SLOTS, loadGuardiesDayVersions } from '../../../src/services/guardiesStorage.js';

const emit = defineEmits(['close']);
const store = useGuardiesStore();
const { courseId, date, dayStatus, teacherDirectory } = storeToRefs(store);
const versions = ref([]);
const loading = ref(false);
const restoring = ref(false);
const feedback = ref('');
const feedbackKind = ref('');

const timeFormatter = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS_LABELS = { draft: 'Esborrany', published: 'Publicada', closed: 'Tancada' };

function formatTime(value) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : timeFormatter.format(parsed);
}

function personLabel(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return '';
  const teacher = teacherDirectory.value.find((item) => String(item.email || '').toLowerCase() === value);
  return teacher?.name || value.split('@')[0];
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const rows = computed(() => versions.value.map((version) => {
  const absences = (version.absenceIds || []).length;
  const covered = Object.keys(version.assignments || {}).length;
  const comments = Object.keys(version.comments || {}).length;
  const outings = (version.groupsOut || []).length;
  const replacedBy = personLabel(version.replacedBy);
  return {
    version,
    key: `${version.revision}-${version.clientUpdatedAt || ''}`,
    when: formatTime(version.clientUpdatedAt) || `versió ${version.revision}`,
    status: STATUS_LABELS[version.status] || '',
    summary: [
      plural(absences, 'absència', 'absències'),
      covered ? plural(covered, 'coberta', 'cobertes') : '',
      comments ? plural(comments, 'observació', 'observacions') : '',
      outings ? plural(outings, 'sortida', 'sortides') : '',
    ].filter(Boolean).join(' · '),
    replaced: [formatTime(version.replacedAt), replacedBy ? `per ${replacedBy}` : ''].filter(Boolean).join(' '),
  };
}));

async function load() {
  if (!courseId.value || !date.value) return;
  loading.value = true;
  try {
    versions.value = await loadGuardiesDayVersions(courseId.value, date.value);
  } catch (error) {
    versions.value = [];
    feedback.value = `No s'ha pogut carregar l'historial. ${friendlyError(error)}`;
    feedbackKind.value = 'error';
  } finally {
    loading.value = false;
  }
}

function restore(row) {
  if (!window.confirm(`Vols tornar la jornada a com estava (${row.when})? El que hi ha ara quedarà a l'historial.`)) return;
  restoring.value = true;
  feedback.value = 'Restaurant…';
  feedbackKind.value = '';
  window.dispatchEvent(new CustomEvent('guardies:restore-day-version', { detail: { version: row.version } }));
}

function handleRestoreResult(event) {
  restoring.value = false;
  feedback.value = event.detail?.message || '';
  feedbackKind.value = event.detail?.ok ? 'success' : 'error';
  if (event.detail?.ok) load();
}

watch([courseId, date], () => {
  feedback.value = '';
  load();
});

onMounted(() => {
  window.addEventListener('guardies:day-version-restored', handleRestoreResult);
  load();
});
onBeforeUnmount(() => window.removeEventListener('guardies:day-version-restored', handleRestoreResult));
</script>

<template>
  <section class="day-history" aria-labelledby="day-history-title">
    <header class="day-history-head">
      <div>
        <h2 id="day-history-title">Historial de la jornada</h2>
        <p>Cada canvi desa com estava abans. Se'n guarden les {{ DAY_VERSION_SLOTS }} darreres.</p>
      </div>
      <button type="button" class="ghost" @click="emit('close')">Tanca</button>
    </header>
    <p v-if="feedback" class="day-history-feedback" :class="`is-${feedbackKind}`" role="status" aria-live="polite">{{ feedback }}</p>
    <p v-if="loading && !versions.length" class="day-history-empty">Carregant…</p>
    <p v-else-if="!rows.length" class="day-history-empty">Encara no hi ha cap versió anterior d'aquesta jornada.</p>
    <ol v-else class="day-history-list">
      <li v-for="row in rows" :key="row.key" class="day-history-item">
        <div>
          <strong>{{ row.when }}</strong>
          <span v-if="row.status" class="day-history-status">{{ row.status }}</span>
          <p>{{ row.summary }}</p>
          <small v-if="row.replaced">Substituïda {{ row.replaced }}</small>
        </div>
        <button type="button" class="ghost" :disabled="restoring || dayStatus === 'closed'" @click="restore(row)">Restaura</button>
      </li>
    </ol>
    <p v-if="dayStatus === 'closed' && rows.length" class="day-history-empty">Reobre la jornada per restaurar-ne una versió.</p>
  </section>
</template>
