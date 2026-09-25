<script setup>
import { computed, defineAsyncComponent, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GuardiesTopBar from './GuardiesTopBar.vue';
import GuardiesWorkHeader from './GuardiesWorkHeader.vue';
const GuardiesSetupPanel = defineAsyncComponent(() => import('./GuardiesSetupPanel.vue'));
const GuardiesPatiPanel = defineAsyncComponent(() => import('./GuardiesPatiPanel.vue'));
const GuardiesConvivenciaPanel = defineAsyncComponent(() => import('./GuardiesConvivenciaPanel.vue'));
import GuardiesWorkspace from './GuardiesWorkspace.vue';
const GuardiesTeacherStats = defineAsyncComponent(() => import('./GuardiesTeacherStats.vue'));
const GuardiesGuardCountPanel = defineAsyncComponent(() => import('./GuardiesGuardCountPanel.vue'));
const GuardiesTeacherExclusionsPanel = defineAsyncComponent(() => import('./GuardiesTeacherExclusionsPanel.vue'));
const GuardiesObservationPresetsPanel = defineAsyncComponent(() => import('./GuardiesObservationPresetsPanel.vue'));
const GuardiesAdminStatistics = defineAsyncComponent(() => import('./GuardiesAdminStatistics.vue'));
const GuardiesReleaseNotes = defineAsyncComponent(() => import('./GuardiesReleaseNotes.vue'));
import { signInGuardies } from '../../../src/services/guardiesStorage.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { canWrite, contextReady, authRequired, adminSection, teacherSection, courseId, date } = storeToRefs(store);
const signingIn = ref(false);
const signInError = ref('');
const diagnosticsHref = computed(() => {
  const query = new URLSearchParams({ diagnostic: 'reads' });
  if (courseId.value) query.set('curs', courseId.value);
  if (date.value) query.set('data', date.value);
  return `/diagnostics.html?${query.toString()}`;
});

function openTeacherStats() {
  store.teacherSection = 'stats';
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
}

async function signIn() {
  signingIn.value = true;
  signInError.value = '';
  try {
    const signedIn = await signInGuardies();
    if (signedIn) window.dispatchEvent(new CustomEvent('guardies:auth-changed'));
    else signingIn.value = false;
  } catch (error) {
    signInError.value = error?.message || String(error);
    signingIn.value = false;
  }
}

window.addEventListener('guardies:auth-ready', () => {
  signingIn.value = false;
});
</script>

<template>
  <GuardiesTopBar />
  <Teleport to="#guardies-work-header-root">
    <nav v-if="contextReady && canWrite" class="admin-view-tabs no-print" aria-label="Seccions de guàrdies" role="tablist">
      <button type="button" role="tab" :aria-selected="adminSection === 'daily'" :class="{ active: adminSection === 'daily' }" @click="store.adminSection = 'daily'">Gestió diària</button>
      <button type="button" role="tab" :aria-selected="adminSection === 'config'" :class="{ active: adminSection === 'config' }" @click="store.adminSection = 'config'">Configuració</button>
      <button type="button" role="tab" :aria-selected="adminSection === 'statistics'" :class="{ active: adminSection === 'statistics' }" @click="store.adminSection = 'statistics'">Estadístiques</button>
      <a class="diagnostics-tab" :href="diagnosticsHref">Diagnòstic</a>
    </nav>
    <GuardiesWorkHeader v-show="contextReady && ((canWrite && adminSection === 'daily') || (!canWrite && teacherSection === 'daily'))" />
  </Teleport>
  <Teleport to="#guardies-setup-root">
    <GuardiesAdminStatistics v-if="contextReady && canWrite && adminSection === 'statistics'" />
    <GuardiesSetupPanel v-show="contextReady && canWrite && adminSection === 'config'" />
    <GuardiesTeacherExclusionsPanel v-if="contextReady && canWrite && adminSection === 'config'" />
    <GuardiesGuardCountPanel v-if="contextReady && canWrite && adminSection === 'config'" />
    <GuardiesObservationPresetsPanel v-if="contextReady && canWrite && adminSection === 'config'" />
  </Teleport>
  <Teleport to="#guardies-convivencia-root">
    <GuardiesConvivenciaPanel v-if="contextReady && canWrite && adminSection === 'config'" />
  </Teleport>
  <Teleport to="#guardies-pati-root">
    <GuardiesPatiPanel v-if="contextReady && canWrite && adminSection === 'config'" />
  </Teleport>
  <Teleport to="#guardies-release-notes-root">
    <GuardiesReleaseNotes v-if="contextReady && canWrite && adminSection === 'config'" />
  </Teleport>
  <Teleport v-if="contextReady && !canWrite" to="#guardies-setup-root">
    <section v-if="authRequired" class="guardies-auth-gate no-print">
      <button type="button" :disabled="signingIn" @click="signIn">{{ signingIn ? 'Connectant…' : 'Inicia sessió' }}</button>
      <p v-if="signInError" role="alert">{{ signInError }}</p>
    </section>
    <nav v-if="!authRequired" class="teacher-view-tabs no-print" aria-label="Vista del professorat" role="tablist">
      <button type="button" role="tab" :aria-selected="teacherSection === 'daily'" :class="{ active: teacherSection === 'daily' }" @click="store.teacherSection = 'daily'">Guàrdies del dia</button>
      <button type="button" role="tab" :aria-selected="teacherSection === 'stats'" :class="{ active: teacherSection === 'stats' }" @click="openTeacherStats">Recompte de guàrdies</button>
    </nav>
    <GuardiesTeacherStats v-if="!authRequired && teacherSection === 'stats'" />
  </Teleport>
  <Teleport to="#guardies-workspace-root">
    <GuardiesWorkspace />
  </Teleport>
</template>
