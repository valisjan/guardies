<script setup>
import { computed, reactive, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import {
  DEFAULT_MAIL_CONFIG,
  MAIL_EXAMPLE_FIELDS,
  MAIL_FIELDS,
  mailId,
  normalizeMailConfig,
  renderMailTemplate,
} from '../../../src/modules/guardies/domain/mail.js';
import {
  loadGuardiesMailConfig,
  loadGuardiesMailServiceStatus,
  loadRecentGuardiesMails,
  queueGuardiesMails,
  saveGuardiesMailConfig,
} from '../../../src/services/guardiesStorage.js';

const store = useGuardiesStore();
const { courseId, viewerEmail } = storeToRefs(store);

const KINDS = [
  { kind: 'alliberat', title: 'Guàrdia com a alliberat/da', help: 'Quan s’assigna una guàrdia a qui està alliberat/da perquè el seu grup és de sortida.' },
  { kind: 'pati', title: 'Canvi de zona de pati', help: 'Quan es canvia a mà la zona de pati d’un professor per a un dia concret.' },
];
const STATUS = { pendent: 'Pendent', enviant: 'Enviant', enviat: 'Enviat', 'cancel·lat': 'No enviat', error: 'Error' };
const KIND_LABELS = { alliberat: 'Alliberat/da', pati: 'Pati', prova: 'Prova' };

const config = reactive(structuredClone(DEFAULT_MAIL_CONFIG));
const loaded = ref(false);
const loading = ref(false);
const saving = ref(false);
const testing = ref('');
const feedback = ref('');
const feedbackKind = ref('');
const recent = ref([]);
const serviceLastRun = ref('');
const serviceAccount = ref('');
const savedSignature = ref(JSON.stringify(normalizeMailConfig(DEFAULT_MAIL_CONFIG)));
const bodies = {};

const signature = computed(() => JSON.stringify(normalizeMailConfig(config)));
const dirty = computed(() => loaded.value && signature.value !== savedSignature.value);
const timeFormatter = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatTime = (value) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : timeFormatter.format(parsed);
};

const serviceLabel = computed(() => (serviceLastRun.value
  ? `Servei de correu actiu${serviceAccount.value ? ` (envia ${serviceAccount.value})` : ''} · darrera revisió ${formatTime(serviceLastRun.value)}`
  : 'Encara no s’ha detectat el servei de correu. Mentre no estigui en marxa, els correus queden a la cua.'));

// «{nom}»: dins de {{ }} de la plantilla no es pot escriure tal qual.
const token = (field) => `{${field}}`;

function preview(kind) {
  return {
    subject: renderMailTemplate(config[kind].subject, MAIL_EXAMPLE_FIELDS[kind]),
    body: renderMailTemplate(config[kind].body, MAIL_EXAMPLE_FIELDS[kind]),
  };
}

function statusLabel(mail) {
  if (mail.status === 'pendent') return `Pendent · surt ${formatTime(mail.sendAfter)}`;
  if (mail.status === 'enviat') return `Enviat ${formatTime(mail.sentAt)}`;
  return `${STATUS[mail.status] || mail.status}${mail.reason ? ` · ${mail.reason}` : ''}`;
}

async function load() {
  if (loaded.value || loading.value || !courseId.value) return;
  loading.value = true;
  try {
    const [saved, mails, service] = await Promise.all([
      loadGuardiesMailConfig(courseId.value),
      loadRecentGuardiesMails(courseId.value).catch(() => []),
      loadGuardiesMailServiceStatus().catch(() => ({ lastRunAt: '', account: '' })),
    ]);
    Object.assign(config, structuredClone(saved));
    savedSignature.value = JSON.stringify(saved);
    recent.value = mails;
    serviceLastRun.value = service.lastRunAt;
    serviceAccount.value = service.account;
    loaded.value = true;
  } catch (error) {
    feedback.value = `No s'ha pogut carregar la configuració dels correus. ${friendlyError(error)}`;
    feedbackKind.value = 'error';
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  feedback.value = '';
  try {
    const saved = await saveGuardiesMailConfig(courseId.value, config);
    Object.assign(config, structuredClone(saved));
    savedSignature.value = JSON.stringify(saved);
    feedback.value = 'Desat.';
    feedbackKind.value = 'success';
  } catch (error) {
    feedback.value = `No s'ha pogut desar. ${friendlyError(error)}`;
    feedbackKind.value = 'error';
  } finally {
    saving.value = false;
  }
}

function insertField(kind, field) {
  const textarea = bodies[kind];
  const value = config[kind].body;
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  config[kind].body = `${value.slice(0, start)}{${field}}${value.slice(end)}`;
  requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.setSelectionRange(start + field.length + 2, start + field.length + 2);
  });
}

async function sendTest(kind) {
  if (!viewerEmail.value) return;
  testing.value = kind;
  feedback.value = '';
  try {
    if (dirty.value) await save();
    const now = new Date();
    await queueGuardiesMails(courseId.value, [{
      id: mailId([now.toISOString(), 'prova', kind]),
      kind: 'prova',
      template: kind,
      date: '',
      teacherId: '',
      email: viewerEmail.value,
      fields: MAIL_EXAMPLE_FIELDS[kind],
      check: {},
      sendAfter: now,
    }]);
    recent.value = await loadRecentGuardiesMails(courseId.value).catch(() => recent.value);
    feedback.value = `Prova a la cua per a ${viewerEmail.value}. Un dia feiner entre les 8:00 i les 15:00 surt en un minut; si no, a les 8:00 del següent dia feiner.`;
    feedbackKind.value = 'success';
  } catch (error) {
    feedback.value = `No s'ha pogut enviar la prova. ${friendlyError(error)}`;
    feedbackKind.value = 'error';
  } finally {
    testing.value = '';
  }
}
</script>

<template>
  <details id="mail-panel" class="admin-panel mail-panel no-print" @toggle="$event.target.open && load()">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">✉</span>
        <strong>Correus al professorat</strong>
      </span>
      <span class="cache-info">{{ loaded ? `${KINDS.filter((item) => config[item.kind].enabled).length} actius` : 'Alliberats i pati' }}</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block mail-block">
        <p class="mail-intro">
          Entre les 8:00 i les 15:00 dels dies feiners el correu surt al cap de 2 minuts, i només si el canvi encara és vigent.
          Els canvis fets fora d’aquest horari surten a les 8:00 del següent dia feiner.
        </p>
        <p class="mail-service" :class="{ 'is-missing': loaded && !serviceLastRun }">{{ loading ? 'Carregant…' : serviceLabel }}</p>

        <!-- Fins que no arriba la configuració desada, editar-la seria perdre-ho en carregar. -->
        <fieldset class="mail-form" :disabled="!loaded">
        <div class="mail-sender">
          <label>
            <span>Nom del remitent</span>
            <input v-model="config.senderName" type="text" maxlength="120" />
          </label>
          <label>
            <span>Respostes a (opcional)</span>
            <input v-model="config.replyTo" type="email" maxlength="320" placeholder="caps.estudis@iesjosepsuredaiblanes.com" />
          </label>
        </div>

        <article v-for="item in KINDS" :key="item.kind" class="mail-template" :data-mail-template="item.kind">
          <header>
            <label class="mail-toggle">
              <input v-model="config[item.kind].enabled" type="checkbox" />
              <strong>{{ item.title }}</strong>
            </label>
            <small>{{ item.help }}</small>
          </header>
          <label>
            <span>Assumpte</span>
            <input v-model="config[item.kind].subject" type="text" maxlength="200" :aria-label="`Assumpte: ${item.title}`" />
          </label>
          <label>
            <span>Text</span>
            <textarea
              :ref="(node) => { bodies[item.kind] = node; }"
              v-model="config[item.kind].body"
              rows="6"
              maxlength="4000"
              :aria-label="`Text: ${item.title}`"
            ></textarea>
          </label>
          <div class="mail-fields" :aria-label="`Camps: ${item.title}`">
            <span>Camps:</span>
            <button
              v-for="[field, label] in MAIL_FIELDS[item.kind]"
              :key="field"
              type="button"
              :title="label"
              @click="insertField(item.kind, field)"
            >{{ token(field) }}</button>
          </div>
          <div class="mail-preview" aria-label="Previsualització">
            <strong>{{ preview(item.kind).subject }}</strong>
            <p>{{ preview(item.kind).body }}</p>
          </div>
          <button type="button" class="ghost" :disabled="!viewerEmail || !!testing || saving" @click="sendTest(item.kind)">
            {{ testing === item.kind ? 'Enviant…' : 'Envia’m una prova' }}
          </button>
        </article>
        </fieldset>

        <div class="mail-actions">
          <button type="button" :disabled="!dirty || saving" @click="save">{{ saving ? 'Desant…' : 'Desa' }}</button>
          <span v-if="feedback" class="mail-feedback" :class="`is-${feedbackKind}`" role="status" aria-live="polite">{{ feedback }}</span>
        </div>

        <section v-if="recent.length" class="mail-recent" aria-labelledby="mail-recent-title">
          <h3 id="mail-recent-title">Darrers correus</h3>
          <ul>
            <li v-for="mail in recent" :key="mail.id" :class="`is-${mail.status === 'cancel·lat' ? 'cancelled' : mail.status}`">
              <strong>{{ mail.kind === 'prova' ? mail.email : mail.fields?.nom_complet || mail.email }}</strong>
              <span>{{ KIND_LABELS[mail.kind] || mail.kind }}{{ mail.fields?.data ? ` · ${mail.fields.data}` : '' }}{{ mail.fields?.hora ? ` · ${mail.fields.hora}` : '' }}{{ mail.fields?.zona ? ` · ${mail.fields.zona}` : '' }}</span>
              <small>{{ statusLabel(mail) }}</small>
            </li>
          </ul>
        </section>
      </section>
    </div>
  </details>
</template>
