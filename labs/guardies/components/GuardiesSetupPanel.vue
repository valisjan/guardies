<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const definitions = [
  { kind: 'reference', title: 'XML GestIB', accept: '.xml,text/xml,application/xml,*/*' },
  { kind: 'untis', title: 'Professorat Untis (GPU004)', accept: '.txt,.csv,text/plain,text/csv,*/*' },
  { kind: 'duties', title: 'Horari i guàrdies Untis (GPU001)', accept: '.txt,.csv,text/plain,text/csv,*/*' },
];

const store = useGuardiesStore();
const {
  referenceText, referenceName, untisText, untisName, dutiesText, dutiesName,
  persistenceStatus, courseName, courseId, canWrite,
} = storeToRefs(store);

const values = computed(() => ({
  reference: { text: referenceText.value, name: referenceName.value },
  untis: { text: untisText.value, name: untisName.value },
  duties: { text: dutiesText.value, name: dutiesName.value },
}));

const uploads = computed(() => {
  let previousComplete = true;
  return definitions.map((definition) => {
    const value = values.value[definition.kind];
    const loaded = Boolean(value.text);
    const lockedByOrder = !loaded && !previousComplete;
    const locked = !canWrite.value || persistenceStatus.value === 'saving' || lockedByOrder;
    previousComplete = previousComplete && loaded;
    return {
      ...definition,
      loaded,
      locked,
      filename: loaded ? value.name || 'Fitxer carregat' : 'No carregat',
      status: loaded ? 'OK' : canWrite.value && lockedByOrder ? 'Pas anterior' : 'Pendent',
    };
  });
});

const cacheLabel = computed(() => {
  if (persistenceStatus.value === 'loading') return 'Connectant amb Firebase...';
  if (persistenceStatus.value === 'stale') return 'Dades locals · reintentant connexió...';
  if (persistenceStatus.value === 'saving') return 'Guardant a Firebase...';
  const count = uploads.value.filter((upload) => upload.loaded).length;
  const course = courseName.value || courseId.value || 'curs actiu';
  const mode = canWrite.value ? 'compartits' : 'només lectura';
  return `${count}/3 fitxers ${mode} · ${course}`;
});

function selectFile(event, kind) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) window.dispatchEvent(new CustomEvent('guardies:upload-file', { detail: { file, kind } }));
}

function removeFile(kind) {
  window.dispatchEvent(new CustomEvent('guardies:remove-file', { detail: { kind } }));
}

function clearFiles() {
  window.dispatchEvent(new CustomEvent('guardies:clear-files'));
}

function reloadDirectory() {
  window.dispatchEvent(new CustomEvent('guardies:reload-directory'));
}
</script>

<template>
  <details id="admin-panel" class="admin-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">⚙</span>
        <strong>Arxius de configuració</strong>
      </span>
      <span id="cache-info" class="cache-info">{{ cacheLabel }}</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block admin-uploads setup-files">
        <div class="admin-block-head">
          <div>
            <p class="kicker">Preparació</p>
            <h2>Fitxers necessaris</h2>
          </div>
          <button id="clear-cache" type="button" class="ghost" :disabled="!canWrite || persistenceStatus === 'saving'" @click="clearFiles">Neteja fitxers</button>
          <button v-if="canWrite" type="button" class="ghost" :disabled="persistenceStatus === 'saving'" @click="reloadDirectory">Actualitza directori</button>
        </div>
        <ol class="setup-list">
          <li v-for="(upload, index) in uploads" :key="upload.kind" class="setup-step" :class="{ complete: upload.loaded, locked: upload.locked }" :data-upload-step="upload.kind">
            <span class="setup-number">{{ index + 1 }}</span>
            <span class="setup-copy"><strong>{{ upload.title }}</strong><small :data-upload-name="upload.kind">{{ upload.filename }}</small></span>
            <span class="setup-status" :data-upload-status="upload.kind">{{ upload.status }}</span>
            <label class="upload" :class="{ 'upload-secondary': upload.kind !== 'duties', disabled: upload.locked }">
              <span :data-upload-action="upload.kind">{{ upload.loaded ? 'Substitueix' : 'Carrega' }}</span>
              <input :id="`${upload.kind}-file`" type="file" :accept="upload.accept" :disabled="upload.locked" @change="selectFile($event, upload.kind)" />
            </label>
            <button type="button" class="remove-upload" :aria-label="`Elimina ${upload.title}`" :data-remove-upload="upload.kind" :disabled="!upload.loaded || !canWrite || persistenceStatus === 'saving'" @click="removeFile(upload.kind)">X</button>
          </li>
        </ol>
      </section>
    </div>
  </details>
</template>
