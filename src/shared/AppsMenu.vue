<script setup lang="ts">
// Botó «Apps» comú a les quatre aplicacions del centre.
// Còpia idèntica a Quota, Guàrdies, Pantalles i Retards (src/shared/): si es canvia, cal canviar-la a totes.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { centreApps } from './apps';

const props = defineProps({
  current: { type: String, required: true },
  signedIn: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  canRetards: { type: Boolean, default: false },
  courseId: { type: String, default: '' },
});

const apps = computed(() => centreApps({
  signedIn: props.signedIn, isAdmin: props.isAdmin, canRetards: props.canRetards, courseId: props.courseId,
}));

const open = ref(false);
const root = ref<HTMLElement | null>(null);
function closeOnOutside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('click', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <div v-if="apps.length" ref="root" class="centre-apps">
    <button
      type="button"
      class="centre-apps-button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="centre-apps-list"
      @click="open = !open"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></svg>
      <span class="centre-apps-label">Apps</span>
    </button>
    <div v-if="open" id="centre-apps-list" class="centre-apps-popover">
      <template v-for="app in apps" :key="app.key">
        <span v-if="app.key === current" class="centre-apps-link is-current" aria-current="page" :data-app="app.key">
          <strong>{{ app.name }}</strong>
          <small>Ets aquí</small>
        </span>
        <a v-else :href="app.href" class="centre-apps-link" :data-app="app.key" @click="open = false">
          <strong>{{ app.name }}</strong>
          <small>{{ app.description }}</small>
        </a>
      </template>
    </div>
  </div>
</template>

<style scoped>
.centre-apps {
  --apps-surface: #ffffff;
  --apps-hover: #f1f0ec;
  --apps-border: #e3e1da;
  --apps-text: #15171c;
  --apps-muted: #5b6170;
  --apps-accent: #3348c8;
  position: relative;
  flex-shrink: 0;
  font-family: inherit;
}

:global(.dark) .centre-apps {
  --apps-surface: #181b22;
  --apps-hover: #232733;
  --apps-border: #2d323d;
  --apps-text: #ecedf1;
  --apps-muted: #a4aab7;
  --apps-accent: #9aa8ff;
}

.centre-apps-button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--apps-border);
  border-radius: 8px;
  background: transparent;
  color: var(--apps-muted);
  cursor: pointer;
  padding: 0 10px;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.centre-apps-button:hover,
.centre-apps-button[aria-expanded='true'] {
  background: var(--apps-hover);
  color: var(--apps-text);
}

.centre-apps-popover {
  position: absolute;
  z-index: 60;
  top: calc(100% + 8px);
  left: 0;
  display: grid;
  width: 250px;
  gap: 2px;
  border: 1px solid var(--apps-border);
  border-radius: 10px;
  background: var(--apps-surface);
  padding: 6px;
  box-shadow: 0 16px 40px rgb(20 24 32 / 0.16);
}

.centre-apps-link {
  display: grid;
  gap: 2px;
  border-radius: 8px;
  color: var(--apps-text);
  padding: 9px 12px;
  text-align: left;
  text-decoration: none;
}

a.centre-apps-link:hover,
a.centre-apps-link:focus-visible {
  background: var(--apps-hover);
}

.centre-apps-link strong {
  font-size: 0.875rem;
}

.centre-apps-link small {
  color: var(--apps-muted);
  font-size: 0.75rem;
}

.centre-apps-link.is-current {
  box-shadow: inset 3px 0 0 var(--apps-accent);
}

@media (max-width: 620px) {
  .centre-apps-button {
    width: 36px;
    justify-content: center;
    padding: 0;
  }

  .centre-apps-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

.centre-apps-link.is-current small {
  color: var(--apps-accent);
  font-weight: 700;
}
</style>
