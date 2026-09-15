<script setup>
import { ref } from 'vue';
import { useGuardiesStore } from '../stores/guardies.js';
import { saveGuardiesObservationPresets } from '../../../src/services/guardiesStorage.js';

const state = useGuardiesStore();
const phrase = ref('');
const saving = ref(false);
const error = ref('');

async function persist(next) {
  const previous = [...state.observationPresets];
  state.observationPresets = next;
  saving.value = true;
  error.value = '';
  try {
    state.observationPresets = await saveGuardiesObservationPresets(state.courseId, next);
  } catch (saveError) {
    state.observationPresets = previous;
    error.value = saveError?.message || String(saveError);
  } finally {
    saving.value = false;
  }
}

async function addPhrase() {
  const value = phrase.value.trim().replace(/\s+/g, ' ');
  if (!value) return;
  const exists = state.observationPresets.some((item) => item.localeCompare(value, 'ca', { sensitivity: 'base' }) === 0);
  phrase.value = '';
  if (!exists) await persist([...state.observationPresets, value]);
}

function removePhrase(value) {
  persist(state.observationPresets.filter((item) => item !== value));
}
</script>

<template>
  <details id="observation-presets-panel" class="admin-panel observation-presets-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">✎</span>
        <strong>Observacions preestablertes</strong>
      </span>
      <span class="cache-info">{{ state.observationPresets.length }} frases</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block">
        <form class="observation-preset-form" @submit.prevent="addPhrase">
          <input v-model="phrase" type="text" maxlength="180" placeholder="Nova observació" aria-label="Nova observació preestablerta" />
          <button type="submit" :disabled="saving || !phrase.trim()">Afegeix</button>
        </form>
        <div v-if="state.observationPresets.length" class="observation-preset-list">
          <span v-for="item in state.observationPresets" :key="item">
            {{ item }}
            <button type="button" :disabled="saving" :aria-label="`Elimina ${item}`" @click="removePhrase(item)">×</button>
          </span>
        </div>
        <div v-else class="empty-small">Cap frase configurada.</div>
        <p v-if="error" class="guard-count-error" role="alert">{{ error }}</p>
      </section>
    </div>
  </details>
</template>
