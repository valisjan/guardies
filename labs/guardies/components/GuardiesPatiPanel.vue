<script setup>
import { computed, ref, watch } from 'vue';
import { useGuardiesStore } from '../stores/guardies';
import { saveGuardiesPati } from '../../../src/services/guardiesStorage';
import {
  WEEKDAYS,
  addDays,
  nonTeachingReason,
  normalizePatioConfig,
  officialSchoolCalendar,
  patioAssignmentsForDate,
  schoolYearStart,
  weekDates,
} from '../../../src/modules/guardies/domain/patio';

const state = useGuardiesStore();
const activeDay = ref('1');
const saving = ref(false);
const saveMessage = ref('');
const holidayDate = ref('');
const holidayLabel = ref('');
const selectedTeacher = ref('');
const teacherQuery = ref('');
const showTeacherResults = ref(false);
const activeTeacherResult = ref(0);
const newZoneName = ref('');
const weekAnchor = ref(state.date);
const draggingZoneId = ref('');
const dragTargetZoneId = ref('');
let saveTimer = null;
let lastSavedSignature = '';
let replacingDraft = false;

function detectedStartYear() {
  return schoolYearStart(state.referencia?.any || state.courseName || state.courseId);
}

const draft = ref(normalizePatioConfig({}, { startYear: detectedStartYear() }));

function cloneConfig(value) {
  return normalizePatioConfig(value || {}, { startYear: value?.startYear || detectedStartYear() });
}

function teacherLabel(teacherId) {
  return state.professorOptions.find((teacher) => teacher.placa === teacherId)?.label
    || teacherId
    || 'Professor/a sense nom';
}

function signature(value) {
  return JSON.stringify(normalizePatioConfig(value, { startYear: value?.startYear || detectedStartYear() }));
}

function replaceDraft(value) {
  replacingDraft = true;
  draft.value = cloneConfig(value);
  lastSavedSignature = signature(draft.value);
  queueMicrotask(() => { replacingDraft = false; });
}

watch(() => state.patiConfig, (value) => {
  replaceDraft(value || { startYear: detectedStartYear() });
}, { immediate: true });

watch(() => state.referencia?.any, () => {
  const startYear = detectedStartYear();
  if (!state.patiConfig && draft.value.startYear !== startYear) {
    replaceDraft({ ...draft.value, startYear, courseStart: '', courseEnd: '' });
  }
});

watch(draft, () => {
  if (replacingDraft || !state.canWrite || !state.courseId) return;
  const currentSignature = signature(draft.value);
  if (currentSignature === lastSavedSignature) return;
  saveMessage.value = 'Canvis pendents…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAutomatically, 450);
}, { deep: true });

watch(() => state.date, (value) => {
  if (value) weekAnchor.value = value;
});

const official = computed(() => officialSchoolCalendar(draft.value.startYear));
const selectedRoster = computed(() => draft.value.weekdayTeachers[activeDay.value] || []);
function isActiveTeacher(teacherId) {
  return state.professorOptions.some((teacher) => teacher.placa === teacherId);
}
const visibleRoster = computed(() => selectedRoster.value
  .filter((teacher) => isActiveTeacher(teacher.teacherId)));
const selectableTeachers = computed(() => {
  const selected = new Set(selectedRoster.value.map((item) => item.teacherId));
  return state.professorOptions
    .filter((teacher) => !selected.has(teacher.placa))
    .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));
});
const teacherResults = computed(() => {
  const query = normalizeSearch(teacherQuery.value);
  if (!query) return [];
  return selectableTeachers.value
    .filter((teacher) => normalizeSearch(`${teacher.label} ${teacher.placa} ${teacher.short || ''}`).includes(query))
    .slice(0, 10);
});
const previewDates = computed(() => weekDates(weekAnchor.value));
const configuredTeacherCount = computed(() => WEEKDAYS.reduce(
  (total, day) => total + draft.value.weekdayTeachers[day.id]
    .filter((teacher) => isActiveTeacher(teacher.teacherId)).length,
  0,
));

function uniqueZoneId() {
  let index = draft.value.zones.length + 1;
  while (draft.value.zones.some((zone) => zone.id === `zona-${index}`)) index += 1;
  return `zona-${index}`;
}

function addZone() {
  const name = newZoneName.value.trim();
  if (!name) return;
  const id = uniqueZoneId();
  draft.value.zones.push({ id, name });
  WEEKDAYS.forEach(({ id: dayId }) => {
    draft.value.weekdayTeachers[dayId].forEach((teacher, index) => {
      if (!teacher.startZoneId) teacher.startZoneId = draft.value.zones[index % draft.value.zones.length].id;
    });
  });
  newZoneName.value = '';
}

function removeZone(zoneId) {
  draft.value.zones = draft.value.zones.filter((zone) => zone.id !== zoneId);
  WEEKDAYS.forEach(({ id }) => {
    draft.value.weekdayTeachers[id].forEach((teacher, index) => {
      if (teacher.startZoneId === zoneId) {
        teacher.startZoneId = draft.value.zones[index % Math.max(1, draft.value.zones.length)]?.id || '';
      }
    });
  });
}

function moveZone(zoneId, targetIndex) {
  const fromIndex = draft.value.zones.findIndex((zone) => zone.id === zoneId);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex >= draft.value.zones.length || fromIndex === targetIndex) return;
  const [zone] = draft.value.zones.splice(fromIndex, 1);
  draft.value.zones.splice(targetIndex, 0, zone);
}

function startZoneDrag(event, zoneId) {
  draggingZoneId.value = zoneId;
  dragTargetZoneId.value = '';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', zoneId);
}

function dropZone(event, targetIndex) {
  const zoneId = draggingZoneId.value || event.dataTransfer.getData('text/plain');
  moveZone(zoneId, targetIndex);
  finishZoneDrag();
}

function finishZoneDrag() {
  draggingZoneId.value = '';
  dragTargetZoneId.value = '';
}

function startZonePointerDrag(event, zoneId) {
  if (event.pointerType === 'mouse') return;
  draggingZoneId.value = zoneId;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveZonePointer(event) {
  if (!draggingZoneId.value || event.pointerType === 'mouse') return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-pati-zone-index]');
  if (!target) return;
  const targetZoneId = target.dataset.patiZoneId;
  if (!targetZoneId || targetZoneId === dragTargetZoneId.value) return;
  dragTargetZoneId.value = targetZoneId;
  moveZone(draggingZoneId.value, Number(target.dataset.patiZoneIndex));
}

function addTeacher(teacherId = selectedTeacher.value) {
  if (!teacherId || selectedRoster.value.some((teacher) => teacher.teacherId === teacherId)) return;
  selectedRoster.value.push({
    teacherId,
    startZoneId: draft.value.zones[selectedRoster.value.length % Math.max(1, draft.value.zones.length)]?.id || '',
  });
  selectedTeacher.value = '';
  teacherQuery.value = '';
  showTeacherResults.value = false;
  activeTeacherResult.value = 0;
}

function removeTeacher(teacherId) {
  draft.value.weekdayTeachers[activeDay.value] = selectedRoster.value
    .filter((teacher) => teacher.teacherId !== teacherId);
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function onTeacherInput() {
  const current = state.professorOptions.find((teacher) => teacher.placa === selectedTeacher.value);
  if (!current || teacherQuery.value !== current.label) selectedTeacher.value = '';
  showTeacherResults.value = true;
  activeTeacherResult.value = 0;
}

function chooseTeacher(teacher) {
  selectedTeacher.value = teacher.placa;
  teacherQuery.value = teacher.label;
  showTeacherResults.value = false;
  addTeacher(teacher.placa);
}

function onTeacherKeydown(event) {
  if (event.key === 'ArrowDown' && teacherResults.value.length) {
    event.preventDefault();
    showTeacherResults.value = true;
    activeTeacherResult.value = (activeTeacherResult.value + 1) % teacherResults.value.length;
    return;
  }
  if (event.key === 'ArrowUp' && teacherResults.value.length) {
    event.preventDefault();
    showTeacherResults.value = true;
    activeTeacherResult.value = (activeTeacherResult.value - 1 + teacherResults.value.length) % teacherResults.value.length;
    return;
  }
  if (event.key === 'Enter') {
    const teacher = teacherResults.value[activeTeacherResult.value];
    if (!teacher) return;
    event.preventDefault();
    chooseTeacher(teacher);
  }
}

function addHoliday() {
  if (!holidayDate.value) return;
  const existing = draft.value.customHolidays.find((holiday) => holiday.date === holidayDate.value);
  if (existing) existing.label = holidayLabel.value.trim() || existing.label;
  else draft.value.customHolidays.push({
    date: holidayDate.value,
    label: holidayLabel.value.trim() || 'Dia no lectiu del centre',
  });
  draft.value.customHolidays.sort((a, b) => a.date.localeCompare(b.date));
  holidayDate.value = '';
  holidayLabel.value = '';
}

function formatDate(value, withWeekday = false) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('ca-ES', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function previewFor(date) {
  return {
    reason: nonTeachingReason(date, draft.value),
    assignments: patioAssignmentsForDate(date, draft.value),
  };
}

function moveWeek(amount) {
  weekAnchor.value = addDays(previewDates.value[0], amount * 7);
}

async function saveAutomatically() {
  if (!state.canWrite || !state.courseId) return;
  if (saving.value) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAutomatically, 200);
    return;
  }
  const pendingSignature = signature(draft.value);
  if (pendingSignature === lastSavedSignature) return;
  saving.value = true;
  saveMessage.value = 'Desant automàticament…';
  try {
    const clean = await saveGuardiesPati(state.courseId, draft.value);
    lastSavedSignature = signature(clean);
    if (signature(draft.value) === pendingSignature) state.patiConfig = clean;
    else saveTimer = setTimeout(saveAutomatically, 200);
    saveMessage.value = 'Desat automàticament';
    window.dispatchEvent(new CustomEvent('guardies:pati-updated'));
  } catch (error) {
    saveMessage.value = `No s'ha pogut desar: ${error.message || error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <details id="pati-panel" class="admin-panel pati-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">◎</span>
        <strong>Patis i rotació de zones</strong>
      </span>
      <span class="cache-info">{{ draft.zones.length }} zones · {{ configuredTeacherCount }} torns setmanals</span>
    </summary>

    <div class="pati-admin-grid">
      <section class="admin-block pati-zones-block">
        <div class="admin-block-head">
          <div>
            <p class="kicker">1 · Espais</p>
            <h2>Zones de pati</h2>
          </div>
        </div>
        <form v-if="state.canWrite" class="pati-add-zone" @submit.prevent="addZone">
          <input
            id="new-pati-zone"
            v-model="newZoneName"
            type="text"
            maxlength="80"
            placeholder="Nom de la nova zona"
            aria-label="Nom de la nova zona"
          />
          <button id="add-pati-zone" type="submit" :disabled="!newZoneName.trim()">Afegeix</button>
        </form>
        <div v-if="draft.zones.length" class="pati-zone-list">
          <div
            v-for="(zone, index) in draft.zones"
            :key="zone.id"
            class="pati-zone-row"
            :class="{ 'is-dragging': draggingZoneId === zone.id, 'is-drop-target': dragTargetZoneId === zone.id }"
            :data-pati-zone-id="zone.id"
            :data-pati-zone-index="index"
            @dragenter.prevent="dragTargetZoneId = zone.id"
            @dragover.prevent
            @drop.prevent="dropZone($event, index)"
          >
            <button
              v-if="state.canWrite"
              type="button"
              class="pati-zone-drag"
              draggable="true"
              :aria-label="`Arrossega ${zone.name}`"
              aria-keyshortcuts="ArrowUp ArrowDown"
              @dragstart="startZoneDrag($event, zone.id)"
              @dragend="finishZoneDrag"
              @pointerdown="startZonePointerDrag($event, zone.id)"
              @pointermove.prevent="moveZonePointer"
              @pointerup="finishZoneDrag"
              @pointercancel="finishZoneDrag"
              @keydown.up.prevent="moveZone(zone.id, index - 1)"
              @keydown.down.prevent="moveZone(zone.id, index + 1)"
            ><span aria-hidden="true">✥</span></button>
            <span>{{ index + 1 }}</span>
            <input v-model.trim="zone.name" :aria-label="`Nom de la zona ${index + 1}`" :disabled="!state.canWrite" maxlength="80" />
            <button v-if="state.canWrite" type="button" class="icon-remove" :aria-label="`Elimina ${zone.name}`" @click="removeZone(zone.id)">×</button>
          </div>
        </div>
        <div v-else class="empty-small">Cap zona configurada.</div>
      </section>

      <section class="admin-block pati-roster-block">
        <div class="admin-block-head">
          <div>
            <p class="kicker">2 · Professorat</p>
            <h2>GP de cada dia</h2>
          </div>
        </div>
        <div class="pati-day-tabs" role="tablist" aria-label="Dia de la setmana">
          <button
            v-for="day in WEEKDAYS"
            :key="day.id"
            type="button"
            role="tab"
            :aria-selected="activeDay === day.id"
            :class="{ active: activeDay === day.id }"
            @click="activeDay = day.id; selectedTeacher = ''; teacherQuery = ''; showTeacherResults = false"
          >
            {{ day.short }} <span>{{ draft.weekdayTeachers[day.id].filter((teacher) => isActiveTeacher(teacher.teacherId)).length }}</span>
          </button>
        </div>
        <div v-if="state.canWrite" class="pati-add-teacher">
          <div class="pati-teacher-autocomplete">
            <input
              id="pati-teacher-search"
              v-model="teacherQuery"
              type="search"
              autocomplete="off"
              placeholder="Escriu nom o codi del professor..."
              aria-label="Professor/a que fa guàrdia de pati"
              aria-autocomplete="list"
              :aria-expanded="showTeacherResults && teacherResults.length > 0"
              :aria-activedescendant="showTeacherResults && teacherResults.length ? `pati-teacher-result-${activeTeacherResult}` : undefined"
              @input="onTeacherInput"
              @focus="showTeacherResults = true"
              @keydown.escape="showTeacherResults = false"
              @keydown="onTeacherKeydown"
            />
            <div v-if="showTeacherResults && teacherResults.length" class="pati-teacher-results" role="listbox">
              <button
                v-for="(teacher, index) in teacherResults"
                :key="teacher.placa"
                :id="`pati-teacher-result-${index}`"
                type="button"
                role="option"
                :aria-selected="index === activeTeacherResult"
                :class="{ suggested: index === activeTeacherResult }"
                @mousedown.prevent="chooseTeacher(teacher)"
              >
                <strong>{{ teacher.label }}</strong>
              </button>
            </div>
          </div>
        </div>
        <div v-if="visibleRoster.length" class="pati-roster-list">
          <div v-for="teacher in visibleRoster" :key="teacher.teacherId" class="pati-roster-row">
            <div>
              <strong>{{ teacherLabel(teacher.teacherId) }}</strong>
            </div>
            <label>
              Zona inicial
              <select v-model="teacher.startZoneId" :disabled="!state.canWrite || !draft.zones.length">
                <option value="">Automàtica</option>
                <option v-for="zone in draft.zones" :key="zone.id" :value="zone.id">{{ zone.name }}</option>
              </select>
            </label>
            <button v-if="state.canWrite" type="button" class="icon-remove" :aria-label="`Elimina ${teacherLabel(teacher.teacherId)}`" @click="removeTeacher(teacher.teacherId)">×</button>
          </div>
        </div>
        <div v-else class="empty-small">Cap professor de GP.</div>
      </section>

      <section class="admin-block pati-calendar-block">
        <div class="admin-block-head">
          <div>
            <p class="kicker">3 · Calendari</p>
            <h2>Dies no lectius</h2>
          </div>
          <a
            v-if="official.sourceUrl"
            class="source-chip official"
            :href="official.sourceUrl"
            target="_blank"
            rel="noreferrer"
          >CAIB {{ draft.startYear }}–{{ draft.startYear + 1 }} ↗</a>
          <span v-else class="source-chip official">Calendari pendent de validar</span>
        </div>
        <div class="official-calendar-summary">
          <span>{{ formatDate(official.courseStart) }}–{{ formatDate(official.courseEnd) }}</span>
          <span v-for="range in official.ranges" :key="range.start">{{ range.label }} · {{ formatDate(range.start) }}–{{ formatDate(range.end) }}</span>
          <span v-for="holiday in official.dates.filter((item) => !official.ranges.some((range) => item.date >= range.start && item.date <= range.end))" :key="holiday.date">{{ formatDate(holiday.date) }} · {{ holiday.label }}</span>
        </div>
        <div v-if="state.canWrite" class="pati-holiday-form">
          <input id="pati-holiday-date" v-model="holidayDate" type="date" :min="draft.courseStart" :max="draft.courseEnd" aria-label="Data no lectiva" />
          <input id="pati-holiday-label" v-model="holidayLabel" type="text" placeholder="Motiu (p. ex. lliure disposició)" aria-label="Motiu del dia no lectiu" />
          <button id="add-pati-holiday" type="button" :disabled="!holidayDate" @click="addHoliday">Afegeix</button>
        </div>
        <div v-if="draft.customHolidays.length" class="custom-holiday-list">
          <span v-for="holiday in draft.customHolidays" :key="holiday.date">
            <strong>{{ formatDate(holiday.date, true) }}</strong> {{ holiday.label }}
            <button v-if="state.canWrite" type="button" :aria-label="`Elimina el dia ${holiday.date}`" @click="draft.customHolidays = draft.customHolidays.filter((item) => item.date !== holiday.date)">×</button>
          </span>
        </div>
      </section>

      <section class="admin-block pati-preview-block">
        <div class="admin-block-head">
          <div>
            <p class="kicker">4 · Resultat</p>
            <h2>Previsualització setmanal</h2>
          </div>
          <div class="week-nav">
            <button type="button" class="ghost" aria-label="Setmana anterior" @click="moveWeek(-1)">←</button>
            <button type="button" class="ghost" @click="weekAnchor = state.date">Avui</button>
            <button type="button" class="ghost" aria-label="Setmana següent" @click="moveWeek(1)">→</button>
          </div>
        </div>
        <div class="pati-week-preview">
          <article v-for="(date, index) in previewDates" :key="date" :class="['pati-day-card', { holiday: previewFor(date).reason }]">
            <header>
              <strong>{{ WEEKDAYS[index].short }}</strong>
              <span>{{ formatDate(date) }}</span>
            </header>
            <p v-if="previewFor(date).reason" class="non-teaching-label">{{ previewFor(date).reason.label }}</p>
            <div v-else-if="previewFor(date).assignments.length" class="pati-preview-assignments">
              <span v-for="assignment in previewFor(date).assignments" :key="assignment.teacherId">
                <strong>{{ assignment.zoneName }}</strong>
                {{ teacherLabel(assignment.teacherId) }}
              </span>
            </div>
            <p v-else class="pati-no-roster">Sense GP configurada</p>
          </article>
        </div>
      </section>
    </div>

    <footer class="pati-save-bar">
      <span v-if="saveMessage" :class="['pati-save-message', { error: saveMessage.startsWith('No') }]">{{ saveMessage }}</span>
      <span v-if="state.canWrite && !saveMessage" class="pati-save-message">Desat automàtic</span>
    </footer>
  </details>
</template>
