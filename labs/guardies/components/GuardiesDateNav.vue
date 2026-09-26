<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const { date, teacherView } = storeToRefs(useGuardiesStore());
const weekdayFormatter = new Intl.DateTimeFormat('ca-ES', { weekday: 'long' });

function localDateString(value) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const parsedDate = computed(() => {
  const parsed = new Date(`${date.value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
});
const weekday = computed(() => (parsedDate.value ? weekdayFormatter.format(parsedDate.value) : ''));
const nonTeachingDay = computed(() => parsedDate.value && [0, 6].includes(parsedDate.value.getDay()));
const isToday = computed(() => date.value === localDateString(new Date()));

function requestDate(value) {
  window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: value } }));
}

function onDateChange(event) {
  requestDate(event.target.value);
  event.target.value = date.value;
}

// Els caps de setmana se salten en avançar o retrocedir.
function shiftDate(days) {
  if (!parsedDate.value) return;
  const next = new Date(parsedDate.value);
  next.setDate(next.getDate() + days);
  if (next.getDay() === 6) next.setDate(next.getDate() + (days > 0 ? 2 : -1));
  if (next.getDay() === 0) next.setDate(next.getDate() + (days > 0 ? 1 : -2));
  requestDate(localDateString(next));
}

function goToday() {
  if (!isToday.value) requestDate(localDateString(new Date()));
}
</script>

<template>
  <div class="nav-date" role="group" aria-label="Dia">
    <button type="button" class="nav-icon-button" aria-label="Dia anterior" title="Dia anterior" @click="shiftDate(-1)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <label class="nav-date-pill" :class="{ 'is-non-teaching': nonTeachingDay }" for="date-input">
      <span class="nav-date-weekday">{{ weekday }}</span>
      <input
        id="date-input"
        type="date"
        :value="date"
        :aria-label="teacherView ? 'Dia de consulta' : 'Dia de treball'"
        @change="onDateChange"
      />
    </label>
    <button type="button" class="nav-icon-button" aria-label="Dia següent" title="Dia següent" @click="shiftDate(1)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
    <button type="button" class="nav-today" :class="{ 'is-today': isToday }" title="Ves a avui" @click="goToday">Avui</button>
  </div>
</template>
