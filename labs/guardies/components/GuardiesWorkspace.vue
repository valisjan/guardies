<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import GuardiesCoveragePanel from './GuardiesCoveragePanel.vue';
import GuardiesIncidentPanel from './GuardiesIncidentPanel.vue';
import { useGuardiesStore } from '../stores/guardies.js';

const { canWrite, authRequired, adminSection, teacherSection, contextReady, persistenceStatus, dayPersistenceStatus, sessions, dayStatus, date } = storeToRefs(useGuardiesStore());
const visible = computed(() => !contextReady.value
  || (canWrite.value && adminSection.value === 'daily')
  || (!canWrite.value && !authRequired.value && teacherSection.value === 'daily'));
const isLoading = computed(() => !contextReady.value || persistenceStatus.value === 'loading' || dayPersistenceStatus.value === 'loading');
const selectedDayIsWeekend = computed(() => {
  if (!date.value) return false;
  const parsed = new Date(`${date.value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && [0, 6].includes(parsed.getDay());
});
const emptyTitle = computed(() => {
  if (isLoading.value) return 'Carregant dades…';
  if (persistenceStatus.value === 'stale') return 'Dades locals carregades · connexió pendent';
  if (persistenceStatus.value === 'error') return 'No s\'ha pogut connectar amb Quota';
  if (dayPersistenceStatus.value === 'stale') return 'Jornada local carregada · connexió pendent';
  if (dayPersistenceStatus.value === 'error') return 'No s\'ha pogut carregar aquesta jornada';
  if (selectedDayIsWeekend.value) return 'Dia no lectiu';
  if (sessions.value.length && !canWrite.value && !['published', 'closed'].includes(dayStatus.value)) return 'Jornada encara no publicada';
  return canWrite.value ? "Carrega l'horari per començar" : 'Encara no hi ha cap full de guàrdies disponible';
});
</script>

<template>
  <section v-show="visible" id="empty-state" class="empty" :class="{ 'is-loading': isLoading }" role="status" aria-live="polite">
    <span v-if="isLoading" class="loading-spinner" aria-hidden="true"></span>
    <h2>{{ emptyTitle }}</h2>
  </section>

  <section v-show="visible && !isLoading" id="workspace" class="workspace hidden">
    <section class="stats hidden" aria-label="Resum de la configuració">
      <strong id="stat-sessions">0</strong>
      <strong id="stat-professors">0</strong>
      <strong id="stat-grups">0</strong>
      <strong id="stat-activitats">0</strong>
      <strong id="stat-reference">No</strong>
    </section>

    <div class="guard-layout" :class="{ 'is-readonly': !canWrite }">
      <GuardiesIncidentPanel v-show="canWrite" />
      <GuardiesCoveragePanel />
    </div>
  </section>
</template>
