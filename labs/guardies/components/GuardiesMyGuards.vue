<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { normalizeGuardCount } from '../../../src/modules/guardies/domain/workflow.js';
import {
  myPublishedGuards,
  teacherHistoryEntries,
  viewerTeacher,
  weeklyTimetable,
} from '../../../src/modules/guardies/domain/my-guards.js';
import { loadMyGuardiesMails, loadUpcomingPublicDays } from '../../../src/services/guardiesStorage.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const {
  courseId, courseName, viewerName, viewerEmail, sessions, professorOptions,
  guardCounts, guardHistory, guardiaCodes, teacherStatsStatus,
} = storeToRefs(store);

const DAYS = ['Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres'];
const MAIL_KINDS = { alliberat: 'Guàrdia com a alliberat/da', pati: 'Canvi de zona de pati' };

const upcomingDays = ref([]);
const upcomingStatus = ref('loading');
const mails = ref([]);
const mailsStatus = ref('loading');

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const longDate = new Intl.DateTimeFormat('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('ca-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
const dateTime = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatDay = (date, format = longDate) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : format.format(parsed);
};
const formatTime = (value) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : dateTime.format(parsed);
};

onMounted(async () => {
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
  const [days, own] = await Promise.allSettled([
    loadUpcomingPublicDays(courseId.value, today()),
    loadMyGuardiesMails(viewerEmail.value),
  ]);
  if (days.status === 'fulfilled') { upcomingDays.value = days.value; upcomingStatus.value = 'ready'; } else upcomingStatus.value = friendlyError(days.reason);
  if (own.status === 'fulfilled') { mails.value = own.value; mailsStatus.value = 'ready'; } else mailsStatus.value = friendlyError(own.reason);
});

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('guardies:release-teacher-stats'));
});

const me = computed(() => viewerTeacher(professorOptions.value, viewerName.value));

const upcoming = computed(() => {
  const byDate = new Map();
  myPublishedGuards(upcomingDays.value, viewerName.value).forEach((guard) => {
    if (!byDate.has(guard.date)) byDate.set(guard.date, []);
    byDate.get(guard.date).push(guard);
  });
  return Array.from(byDate, ([date, guards]) => ({ date, today: date === today(), guards }));
});

const isGuardSession = (session) => Boolean(session.activitatEsGuardia || guardiaCodes.value.has(session.activitat));

const totals = computed(() => {
  if (!me.value) return null;
  const mine = normalizeGuardCount(guardCounts.value.get(me.value.placa));
  // Mitjana entre qui té alguna franja de G a l'horari.
  const withGuard = new Set(sessions.value.filter((session) => session.hora !== 'PATI' && isGuardSession(session)).map((session) => session.placa));
  const values = Array.from(withGuard, (teacherId) => normalizeGuardCount(guardCounts.value.get(teacherId)).guard);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { guard: mine.guard, released: mine.released, average: average.toLocaleString('ca-ES', { maximumFractionDigits: 1 }) };
});

const history = computed(() => {
  if (!me.value) return [];
  return teacherHistoryEntries(guardHistory.value, [me.value.placa, me.value.short, me.value.name, me.value.label])
    .map((entry) => {
      const hour = entry.slot.split('|')[1] || '';
      return { ...entry, hour: hour === 'PATI' ? 'Pati' : hour };
    });
});

function sessionText(session) {
  if (session.hora === 'PATI') return { title: 'Guàrdia de pati', detail: '' };
  if (isGuardSession(session)) return { title: session.activitatCurta || 'Guàrdia', detail: '' };
  if (session.teClasse) {
    return {
      title: session.materiaCurta || session.materiaNom || 'Classe',
      detail: [session.grupVisible, session.aulaNom].filter(Boolean).join(' · '),
    };
  }
  return { title: session.activitatCurta || session.activitatNom || 'Activitat', detail: session.aulaNom || '' };
}

const timetable = computed(() => {
  if (!me.value) return [];
  return weeklyTimetable(sessions.value, me.value.placa, isGuardSession).map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const texts = new Map();
      cell.items.forEach((session) => {
        const text = sessionText(session);
        const key = `${text.title}|${text.detail}`;
        if (!texts.has(key)) texts.set(key, text);
      });
      return { ...cell, texts: Array.from(texts.values()) };
    }),
  }));
});

const visibleMails = computed(() => mails.value
  .filter((mail) => ['pendent', 'enviant', 'enviat'].includes(mail.status) && mail.kind !== 'prova')
  .sort((a, b) => String(b.sendAfter).localeCompare(String(a.sendAfter)))
  .slice(0, 10));

function mailStatus(mail) {
  if (mail.status === 'enviat') return `Enviat ${formatTime(mail.sentAt)}`;
  if (mail.status === 'enviant') return 'Enviant';
  return `Previst · surt ${formatTime(mail.sendAfter)}`;
}

function mailDetail(mail) {
  const fields = mail.fields || {};
  return [fields.data, fields.hora, fields.grup, fields.zona].filter(Boolean).join(' · ');
}

const loadingSchedule = computed(() => ['idle', 'loading'].includes(teacherStatsStatus.value));
</script>

<template>
  <section class="my-guards-panel no-print" aria-labelledby="my-guards-title">
    <header class="my-guards-head">
      <p class="kicker">Curs {{ courseName }}</p>
      <h2 id="my-guards-title">Les meves guàrdies</h2>
    </header>

    <p v-if="loadingSchedule" class="my-guards-note">Carregant el teu horari…</p>
    <p v-else-if="teacherStatsStatus === 'error'" class="my-guards-note is-error">No s’ha pogut carregar l’horari.</p>
    <p v-else-if="!me" class="my-guards-note">No trobem «{{ viewerName }}» a l’horari carregat. Si el nom del compte no coincideix amb el de l’horari, avisa la cap d’estudis.</p>

    <div v-if="totals" class="my-guards-totals">
      <article><strong>{{ totals.guard }}</strong><span>guàrdies de G aquest curs</span></article>
      <article><strong>{{ totals.released }}</strong><span>com a alliberat/da</span></article>
      <article><strong>{{ totals.average }}</strong><span>mitjana de G del claustre</span></article>
    </div>

    <section class="my-guards-section" aria-labelledby="my-upcoming-title">
      <h3 id="my-upcoming-title">Avui i pròxims dies</h3>
      <p v-if="upcomingStatus === 'loading'" class="my-guards-note">Carregant els fulls publicats…</p>
      <p v-else-if="upcomingStatus !== 'ready'" class="my-guards-note is-error">No s’han pogut carregar els fulls. {{ upcomingStatus }}</p>
      <p v-else-if="!upcoming.length" class="my-guards-note">No tens cap guàrdia assignada als fulls publicats a partir d’avui.</p>
      <ul v-else class="my-upcoming" data-my-upcoming>
        <li v-for="day in upcoming" :key="day.date" :class="{ 'is-today': day.today }">
          <strong class="my-upcoming-day">{{ day.today ? 'Avui' : '' }} {{ formatDay(day.date) }}</strong>
          <ul>
            <li v-for="(guard, index) in day.guards" :key="index" :data-my-guard="guard.kind">
              <span class="my-upcoming-hour">{{ guard.hour }}</span>
              <span v-if="guard.kind === 'patio'">Pati · zona <b>{{ guard.zone }}</b></span>
              <span v-else>Cobreixes <b>{{ guard.group }}</b><template v-if="guard.subject"> · {{ guard.subject }}</template><template v-if="guard.room"> · {{ guard.room }}</template><small v-if="guard.absent"> (per {{ guard.absent }})</small></span>
              <small v-if="guard.comment" class="my-upcoming-comment">{{ guard.comment }}</small>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section class="my-guards-section" aria-labelledby="my-mails-title">
      <h3 id="my-mails-title">Avisos per correu</h3>
      <p v-if="mailsStatus === 'loading'" class="my-guards-note">Carregant…</p>
      <p v-else-if="mailsStatus !== 'ready'" class="my-guards-note">Encara no es poden consultar els avisos per correu.</p>
      <p v-else-if="!visibleMails.length" class="my-guards-note">No tens cap avís previst ni enviat.</p>
      <ul v-else class="my-mails" data-my-mails>
        <li v-for="mail in visibleMails" :key="mail.id" :class="`is-${mail.status}`">
          <strong>{{ MAIL_KINDS[mail.kind] || mail.kind }}</strong>
          <span>{{ mailDetail(mail) }}</span>
          <small>{{ mailStatus(mail) }}</small>
        </li>
      </ul>
    </section>

    <section v-if="timetable.length" class="my-guards-section" aria-labelledby="my-timetable-title">
      <h3 id="my-timetable-title">El meu horari</h3>
      <div class="my-timetable-scroll">
        <table class="my-timetable" data-my-timetable>
          <thead>
            <tr><th scope="col"></th><th v-for="day in DAYS" :key="day" scope="col">{{ day }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in timetable" :key="row.hour" :class="{ 'is-patio': row.hour === 'PATI' }">
              <th scope="row">{{ row.label }}</th>
              <td
                v-for="cell in row.cells"
                :key="cell.day"
                :class="{ 'is-guard': cell.kinds.has('guard'), 'is-patio': cell.kinds.has('patio'), 'is-class': cell.kinds.has('class') }"
              >
                <span v-for="(text, index) in cell.texts" :key="index" class="my-timetable-item">
                  <b>{{ text.title }}</b><small v-if="text.detail">{{ text.detail }}</small>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="my-guards-legend"><span class="is-guard">Guàrdia</span><span class="is-patio">Pati</span><span class="is-class">Classe</span></p>
    </section>

    <section v-if="me" class="my-guards-section" aria-labelledby="my-history-title">
      <h3 id="my-history-title">Historial del curs</h3>
      <p v-if="!history.length" class="my-guards-note">Encara no consta cap guàrdia feta aquest curs.</p>
      <ul v-else class="my-history" data-my-history>
        <li v-for="entry in history" :key="`${entry.date}|${entry.slot}`">
          <span>{{ formatDay(entry.date, shortDate) }}</span>
          <span>{{ entry.hour }}</span>
          <strong>{{ entry.groups.join(' + ') }}</strong>
        </li>
      </ul>
    </section>
  </section>
</template>
