<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { normalizeGuardCount } from '../../../src/modules/guardies/domain/workflow.js';
import {
  myPublishedGuards,
  teacherHistoryEntries,
  viewerTeacher,
  weeklyTimetable,
} from '../../../src/modules/guardies/domain/my-guards.js';
import { loadMyGuardiesMails, loadTeacherGuardiesMails, loadUpcomingPublicDays } from '../../../src/services/guardiesStorage.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const {
  courseId, courseName, viewerName, viewAsName, viewerEmail, sessions, professorOptions,
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
const dayTitle = (date) => {
  const text = formatDay(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const formatTime = (value) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : dateTime.format(parsed);
};

const me = computed(() => viewerTeacher(professorOptions.value, viewerName.value));

// «Veure com a»: l'administració mira la vista d'un altre docent. Els seus avisos es
// carreguen pel codi d'Untis (de l'adreça només en sabem la del compte que ha entrat).
const previewing = computed(() => Boolean(viewAsName.value));
async function loadMails() {
  mailsStatus.value = 'loading';
  try {
    mails.value = previewing.value
      ? await loadTeacherGuardiesMails(me.value?.placa)
      : await loadMyGuardiesMails(viewerEmail.value);
    mailsStatus.value = 'ready';
  } catch (error) {
    mailsStatus.value = friendlyError(error);
  }
}
watch(() => (previewing.value ? `com-a:${me.value?.placa || ''}` : 'propi'), loadMails);

onMounted(async () => {
  window.dispatchEvent(new CustomEvent('guardies:load-teacher-stats'));
  const [days] = await Promise.allSettled([loadUpcomingPublicDays(courseId.value, today()), loadMails()]);
  if (days.status === 'fulfilled') { upcomingDays.value = days.value; upcomingStatus.value = 'ready'; } else upcomingStatus.value = friendlyError(days.reason);
});

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('guardies:release-teacher-stats'));
});

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
  if (isGuardSession(session)) return { title: 'Guàrdia', detail: session.activitatCurta && session.activitatCurta !== 'G' ? session.activitatCurta : '' };
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
  return `Previst · ${formatTime(mail.sendAfter)}`;
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
      <div>
        <p class="kicker">Curs {{ courseName }}</p>
        <h2 id="my-guards-title">Les meves guàrdies</h2>
      </div>
      <!-- Els totals del curs, compactes a la capçalera. -->
      <dl v-if="totals" class="my-guards-totals">
        <article><dt>Guàrdies de G</dt><dd><strong>{{ totals.guard }}</strong></dd></article>
        <article><dt>Com a alliberat/da</dt><dd><strong>{{ totals.released }}</strong></dd></article>
        <article><dt>Mitjana del claustre</dt><dd><strong>{{ totals.average }}</strong></dd></article>
      </dl>
    </header>

    <p v-if="loadingSchedule" class="my-guards-note">Carregant el teu horari…</p>
    <p v-else-if="teacherStatsStatus === 'error'" class="my-guards-note is-error">No s’ha pogut carregar l’horari.</p>
    <p v-else-if="!me" class="my-guards-note">No trobem «{{ viewerName }}» a l’horari carregat. Si el nom del compte no coincideix amb el de l’horari, avisa la cap d’estudis.</p>

    <div class="my-guards-columns">
      <section class="my-guards-section my-guards-card" aria-labelledby="my-upcoming-title">
        <h3 id="my-upcoming-title">Avui i pròxims dies</h3>
        <p v-if="upcomingStatus === 'loading'" class="my-guards-note">Carregant els fulls publicats…</p>
        <p v-else-if="upcomingStatus !== 'ready'" class="my-guards-note is-error">No s’han pogut carregar els fulls. {{ upcomingStatus }}</p>
        <p v-else-if="!upcoming.length" class="my-guards-note">No tens cap guàrdia assignada als fulls publicats a partir d’avui.</p>
        <ol v-else class="my-upcoming" data-my-upcoming>
          <li v-for="day in upcoming" :key="day.date" :class="{ 'is-today': day.today }">
            <h4 class="my-upcoming-day"><span v-if="day.today" class="my-today-badge">Avui</span>{{ dayTitle(day.date) }}</h4>
            <ul>
              <li v-for="(guard, index) in day.guards" :key="index" class="my-upcoming-guard" :data-my-guard="guard.kind">
                <span class="my-upcoming-hour">{{ guard.hour }}</span>
                <div v-if="guard.kind === 'patio'" class="my-upcoming-what">
                  <strong>Pati · {{ guard.zone }}</strong>
                </div>
                <div v-else class="my-upcoming-what">
                  <strong>{{ guard.group }}</strong>
                  <span v-if="guard.subject || guard.room" class="my-upcoming-where">{{ [guard.subject, guard.room].filter(Boolean).join(' · ') }}</span>
                  <small v-if="guard.absent">Cobreixes {{ guard.absent }}</small>
                  <p v-if="guard.comment" class="my-upcoming-comment"><b>Observacions</b> {{ guard.comment }}</p>
                </div>
              </li>
            </ul>
          </li>
        </ol>
      </section>

      <section class="my-guards-section my-guards-card" aria-labelledby="my-mails-title">
        <h3 id="my-mails-title">Avisos per correu</h3>
        <p v-if="mailsStatus === 'loading'" class="my-guards-note">Carregant…</p>
        <p v-else-if="mailsStatus !== 'ready'" class="my-guards-note">Encara no es poden consultar els avisos per correu.</p>
        <p v-else-if="!visibleMails.length" class="my-guards-note">No tens cap avís previst ni enviat.</p>
        <ul v-else class="my-mails" data-my-mails>
          <li v-for="mail in visibleMails" :key="mail.id" :class="`is-${mail.status}`">
            <span class="my-mail-status">{{ mailStatus(mail) }}</span>
            <strong>{{ MAIL_KINDS[mail.kind] || mail.kind }}</strong>
            <span class="my-mail-detail">{{ mailDetail(mail) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <section v-if="timetable.length" class="my-guards-section my-guards-card" aria-labelledby="my-timetable-title">
      <div class="my-guards-section-head">
        <h3 id="my-timetable-title">El meu horari</h3>
        <p class="my-guards-legend" aria-label="Llegenda"><span class="is-guard">Guàrdia</span><span class="is-patio">Pati</span><span class="is-class">Classe</span></p>
      </div>
      <div class="my-timetable-scroll">
        <table class="my-timetable" data-my-timetable>
          <thead>
            <tr><th scope="col"><span class="visually-hidden">Hora</span></th><th v-for="day in DAYS" :key="day" scope="col">{{ day }}</th></tr>
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
    </section>

    <section v-if="me" class="my-guards-section my-guards-card" aria-labelledby="my-history-title">
      <h3 id="my-history-title">Historial del curs</h3>
      <p v-if="!history.length" class="my-guards-note">Encara no consta cap guàrdia feta aquest curs.</p>
      <ul v-else class="my-history" data-my-history>
        <li v-for="entry in history" :key="`${entry.date}|${entry.slot}`">
          <span class="my-history-date">{{ formatDay(entry.date, shortDate) }}</span>
          <span class="my-history-hour">{{ entry.hour }}</span>
          <strong>{{ entry.groups.join(' + ') }}</strong>
        </li>
      </ul>
    </section>
  </section>
</template>
