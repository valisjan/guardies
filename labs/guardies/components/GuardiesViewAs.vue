<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { isSamePerson, nameTokens } from '../../../src/modules/guardies/domain/names.js';
import { useGuardiesStore } from '../stores/guardies.js';

// «Veure com a»: només per a l'administració a la vista Professorat. No canvia de compte
// ni de permisos (l'administració ja pot llegir tot el que veu un docent): només posa el
// nom d'un altre docent perquè surtin les seves marques («Assignat avui», «Tu» i les
// franges pròpies del recompte).
const store = useGuardiesStore();
const { publicDay, professorOptions, ownViewerName, viewAsName, teacherStatsStatus } = storeToRefs(store);

const collator = new Intl.Collator('ca', { sensitivity: 'base' });

// Tot el professorat de l'horari del curs (es carrega en obrir la vista) i, a més, qui
// surti a la jornada publicada amb una altra forma del nom. Sense nom complet (només el
// codi d'Untis) no es pot reconèixer ningú, així que no s'hi posa.
const names = computed(() => {
  const found = [];
  const add = (value) => String(value || '').split(' · ').map((name) => name.trim()).forEach((name) => {
    if (nameTokens(name).length < 2 || found.some((other) => isSamePerson(other, name) || isSamePerson(name, other))) return;
    found.push(name);
  });
  (professorOptions.value || []).forEach((teacher) => add(teacher.name));
  (publicDay.value?.hours || []).forEach((hour) => {
    (hour.rows || []).forEach((row) => { add(row.assigned); add(row.absent); });
    (hour.patio?.zones || []).forEach((zone) => add(zone.teacher));
  });
  return found.sort(collator.compare);
});
const loadingTeachers = computed(() => teacherStatsStatus.value === 'loading');

// L'horari del curs porta tot el professorat. Només es demana quan l'administració toca
// el selector: obrir la vista del professorat continua sense carregar cap horari.
function loadTeachers() {
  if (!store.isAdmin || professorOptions.value?.length || loadingTeachers.value) return;
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
}

const selected = computed(() => viewAsName.value);

function viewAs(name) {
  // Només l'administració. Les dades d'un altre docent que no són públiques (els seus
  // correus) les protegeixen a més les regles de Firestore.
  if (!store.isAdmin) return;
  store.viewAsName = name || '';
  store.viewerName = name || ownViewerName.value;
  window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
}
</script>

<template>
  <div class="view-as no-print" :class="{ 'is-active': selected }">
    <label>
      <span>Veure com a</span>
      <select :value="selected" aria-label="Veure com a" @focus="loadTeachers" @pointerdown="loadTeachers" @change="viewAs($event.target.value)">
        <option value="">Jo ({{ ownViewerName || 'administració' }})</option>
        <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
      </select>
    </label>
    <p v-if="selected" role="status">
      Així ho veu <strong>{{ selected }}</strong>: «Assignat avui», «Tu», «Les meves guàrdies» i el recompte.
      <button type="button" class="ghost" @click="viewAs('')">Torna a la meva vista</button>
    </p>
    <p v-else class="view-as-help">
      {{ loadingTeachers ? 'Carregant el professorat de l’horari…' : 'Tria un docent per veure el full, «Les meves guàrdies» i el recompte tal com li surten.' }}
    </p>
  </div>
</template>
