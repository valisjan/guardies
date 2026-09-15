<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import { mergeSharedClassroomAbsences } from '../../../src/modules/guardies/domain/day.js';

const store = useGuardiesStore();
const { absencies, assignacions, sessions, canWrite, dayStatus } = storeToRefs(store);
const autoAssignmentFeedback = ref('');
const autoAssignmentFeedbackKind = ref('');
const canAutoAssign = computed(() => canWrite.value && dayStatus.value !== 'closed' && mergeSharedClassroomAbsences({
  sessions: sessions.value,
  absences: absencies.value,
}).some((item) => (
  !item.sessions?.some((session) => session.activitat === 'GP') && !assignacions.value.has(item.id)
)));

function autoAssign() {
  autoAssignmentFeedback.value = 'Assignant...';
  autoAssignmentFeedbackKind.value = '';
  window.dispatchEvent(new CustomEvent('guardies:auto-assign'));
}

function handleAutoAssignmentResult(event) {
  autoAssignmentFeedback.value = event.detail?.message || '';
  autoAssignmentFeedbackKind.value = event.detail?.ok ? 'success' : 'error';
}

onMounted(() => window.addEventListener('guardies:auto-assign-result', handleAutoAssignmentResult));
onBeforeUnmount(() => window.removeEventListener('guardies:auto-assign-result', handleAutoAssignmentResult));
</script>

<template>
  <section class="day-panel">
    <div class="print-header">
      <img src="/logo_IESJSB_nav.png" alt="" />
      <div class="print-title-copy">
        <span>IES Josep Sureda i Blanes</span>
        <h1>Guàrdies del dia</h1>
      </div>
      <p id="print-date-label"></p>
    </div>
    <div class="day-panel-head no-print">
      <div>
        <p class="kicker">Full de guàrdies</p>
        <h2>Absències per hora</h2>
      </div>
      <div v-if="canWrite" class="day-panel-actions">
        <button id="auto-assign-guards" type="button" :disabled="!canAutoAssign" @click="autoAssign">Assigna automàticament</button>
        <span v-if="autoAssignmentFeedback" class="auto-assignment-feedback" :class="`is-${autoAssignmentFeedbackKind}`" role="status" aria-live="polite">{{ autoAssignmentFeedback }}</span>
      </div>
    </div>
    <div id="coverage-list" class="coverage-list"></div>
    <section v-if="!canWrite" class="teacher-outing-panel no-print" aria-labelledby="teacher-outing-title">
      <header>
        <p class="kicker">Sortides</p>
        <h2 id="teacher-outing-title">Grups de sortida</h2>
      </header>
      <div id="public-outing-list" class="teacher-outing-list"></div>
    </section>
  </section>
</template>
