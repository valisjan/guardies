<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';

// «Veure com a»: només per a l'administració a la vista Professorat. No canvia de compte
// ni de permisos (l'administració ja pot llegir tot el que veu un docent): només posa el
// nom d'un altre docent perquè surtin les seves marques («Avui et toca», «Tu» i les
// franges pròpies del recompte).
const store = useGuardiesStore();
const { publicDay, professorOptions, ownViewerName, viewAsName } = storeToRefs(store);

const collator = new Intl.Collator('ca', { sensitivity: 'base' });

// Docents amb alguna cosa a la jornada publicada i, si ja s'ha carregat el recompte,
// tot el professorat de l'horari.
const names = computed(() => {
  const found = new Set();
  const add = (value) => String(value || '').split(' · ').map((name) => name.trim()).filter(Boolean).forEach((name) => found.add(name));
  (publicDay.value?.hours || []).forEach((hour) => {
    (hour.rows || []).forEach((row) => { add(row.assigned); add(row.absent); });
    (hour.patio?.zones || []).forEach((zone) => add(zone.teacher));
  });
  (professorOptions.value || [])
    .filter((teacher) => teacher.name && ![teacher.short, teacher.placa].includes(teacher.name))
    .forEach((teacher) => add(teacher.name));
  return Array.from(found).sort(collator.compare);
});

const selected = computed(() => viewAsName.value);

function viewAs(name) {
  store.viewAsName = name || '';
  store.viewerName = name || ownViewerName.value;
  window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
}
</script>

<template>
  <div class="view-as no-print" :class="{ 'is-active': selected }">
    <label>
      <span>Veure com a</span>
      <select :value="selected" aria-label="Veure com a" @change="viewAs($event.target.value)">
        <option value="">Jo ({{ ownViewerName || 'administració' }})</option>
        <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
      </select>
    </label>
    <p v-if="selected" role="status">
      Així ho veu <strong>{{ selected }}</strong>: «Avui et toca», «Tu», «Les meves guàrdies» i el recompte.
      <button type="button" class="ghost" @click="viewAs('')">Torna a la meva vista</button>
    </p>
    <p v-else class="view-as-help">Tria un docent per veure el full, «Les meves guàrdies» i el recompte tal com li surten.</p>
  </div>
</template>
