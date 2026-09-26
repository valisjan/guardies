<script setup>
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const { undoToast } = storeToRefs(useGuardiesStore());

function undo() {
  window.dispatchEvent(new CustomEvent('guardies:undo'));
}

function dismiss() {
  window.dispatchEvent(new CustomEvent('guardies:dismiss-undo'));
}
</script>

<template>
  <div class="undo-toast-region no-print" aria-live="polite">
    <div v-if="undoToast" :key="undoToast.id" class="undo-toast" role="status">
      <span>{{ undoToast.message }}</span>
      <button type="button" class="undo-toast-action" @click="undo">Desfés</button>
      <button type="button" class="undo-toast-close" aria-label="Tanca l'avís" @click="dismiss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </div>
</template>
