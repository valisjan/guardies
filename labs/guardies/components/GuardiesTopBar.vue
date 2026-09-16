<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

const dark = ref(document.documentElement.classList.contains('dark'));
const { courseId, date, isAdmin, teacherView } = storeToRefs(useGuardiesStore());
const guardiesHref = computed(() => {
  const query = new URLSearchParams();
  if (courseId.value) query.set('curs', courseId.value);
  if (date.value) query.set('data', date.value);
  const suffix = query.toString();
  return `/${suffix ? `?${suffix}` : ''}`;
});
const professoratHref = computed(() => {
  const query = new URLSearchParams();
  if (courseId.value) query.set('curs', courseId.value);
  if (date.value) query.set('data', date.value);
  query.set('vista', 'professor');
  return `/?${query.toString()}`;
});

function toggleTheme() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('quota_theme', dark.value ? 'dark' : 'light');
  localStorage.setItem('darkMode', dark.value ? 'true' : 'false');
}
</script>

<template>
  <nav class="app-nav" aria-label="Navegació principal">
    <div class="nav-inner">
      <a class="brand" :href="guardiesHref">
        <img src="/logo_IESJSB_nav.png" alt="IES Josep Sureda i Blanes" />
        <span>
          <strong>GUÀRDIES</strong>
          <small>IES Josep Sureda i Blanes</small>
        </span>
      </a>
      <div class="nav-tabs" aria-label="Seccions">
        <a href="https://quota.iessureda.com/">Quota</a>
        <a v-if="isAdmin" :class="{ active: !teacherView }" :href="guardiesHref" :aria-current="!teacherView ? 'page' : undefined">Guàrdies</a>
        <a :class="{ active: teacherView }" :href="professoratHref" :aria-current="teacherView ? 'page' : undefined">Professorat</a>
        <a v-if="isAdmin" href="https://pantalles.iessureda.com/?gestio=1&pantalla=sala-professorat">Pantalles</a>
      </div>
      <button id="theme-toggle" type="button" class="theme-toggle" aria-label="Canvia el tema" @click="toggleTheme">
        <span class="theme-icon" aria-hidden="true">◐</span>
        <span id="theme-label">{{ dark ? 'Clar' : 'Fosc' }}</span>
      </button>
    </div>
    <div class="brand-strip" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  </nav>
</template>
