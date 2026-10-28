<script setup>
import { computed, reactive, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import {
  DEFAULT_MAIL_CONFIG,
  MAIL_EXAMPLE_FIELDS,
  MAIL_FIELDS,
  composeMail,
  isSchoolEmail,
  mailId,
  normalizeMailConfig,
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
  { kind: 'alliberat', title: 'Guàrdia com a alliberat/da', help: 'Quan s’assigna una guàrdia a qui queda lliure perquè el seu grup és de sortida.' },
  { kind: 'pati', title: 'Canvi de zona de pati', help: 'Quan es canvia a mà la zona de pati d’un professor per a un dia concret.' },
];
const KIND_LABELS = { alliberat: 'Alliberat/da', pati: 'Pati', prova: 'Prova' };
const EXAMPLE_NAME = MAIL_EXAMPLE_FIELDS.alliberat.nom_complet;

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
const testEmailInvalid = computed(() => Boolean(config.testEmail.trim()) && !isSchoolEmail(config.testEmail));
const testRecipient = computed(() => (config.testEmail.trim() && !testEmailInvalid.value ? config.testEmail.trim().toLowerCase() : viewerEmail.value));
const timeFormatter = new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatTime = (value) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : timeFormatter.format(parsed);
};

const serviceLabel = computed(() => (serviceLastRun.value
  ? `Servei de correu en marxa${serviceAccount.value ? ` · envia ${serviceAccount.value}` : ''} · darrera revisió ${formatTime(serviceLastRun.value)}`
  : 'Encara no s’ha detectat el servei de correu. Mentre no estigui en marxa, els correus queden a la cua.'));

// «{nom}»: dins de {{ }} de la plantilla no es pot escriure tal qual.
const token = (field) => `{${field}}`;

const preview = (kind) => composeMail(config, [{ kind, fields: MAIL_EXAMPLE_FIELDS[kind] }]);

// Darrers correus: només els que han de sortir (per ordre de sortida) i els enviats.
const scheduledMails = computed(() => recent.value
  .filter((mail) => mail.status === 'pendent' || mail.status === 'enviant')
  .sort((a, b) => String(a.sendAfter).localeCompare(String(b.sendAfter))));
const sentMails = computed(() => recent.value
  .filter((mail) => mail.status === 'enviat')
  .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
  .slice(0, 15));
const mailLists = computed(() => [
  { key: 'previstos', title: 'Previstos', mails: scheduledMails.value },
  { key: 'enviats', title: 'Enviats', mails: sentMails.value },
].filter((list) => list.mails.length));

function statusLabel(mail) {
  if (mail.status === 'pendent') return `Surt ${formatTime(mail.sendAfter)}`;
  if (mail.status === 'enviat') return `Enviat ${formatTime(mail.sentAt)}`;
  return 'Enviant';
}

function mailDetail(mail) {
  if (mail.kind === 'prova') return `Prova · ${KIND_LABELS[mail.template] || mail.template}`;
  const fields = mail.fields || {};
  return [KIND_LABELS[mail.kind] || mail.kind, fields.data, fields.hora, fields.zona].filter(Boolean).join(' · ');
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
  const recipient = testRecipient.value;
  if (!recipient) return;
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
      email: recipient,
      fields: MAIL_EXAMPLE_FIELDS[kind],
      check: {},
      sendAfter: now,
    }]);
    recent.value = await loadRecentGuardiesMails(courseId.value).catch(() => recent.value);
    feedback.value = `Prova a la cua per a ${recipient}. Un dia feiner entre les 8:00 i les 15:00 surt en un minut; si no, a les 8:00 del següent dia feiner.`;
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
      <span class="cache-info">{{ loaded ? (config.active ? 'Enviament actiu' : 'Enviament aturat') : 'Alliberats i pati' }}</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block mail-block">
        <!-- Fins que no arriba la configuració desada, editar-la seria perdre-ho en carregar. -->
        <fieldset class="mail-form" :disabled="!loaded">
          <div class="mail-overview">
            <div class="mail-master" :class="config.active ? 'is-on' : 'is-off'">
              <label class="mail-switch mail-switch-large">
                <input v-model="config.active" type="checkbox" role="switch" aria-label="Enviament al professorat" />
                <span class="mail-switch-track" aria-hidden="true"></span>
                <span>
                  <strong>Enviament al professorat: {{ config.active ? 'actiu' : 'aturat' }}</strong>
                  <small>{{ config.active ? 'Els avisos arriben al professorat.' : 'No s’envia res al professorat; les proves sí.' }}</small>
                </span>
              </label>
              <p class="mail-service" :class="{ 'is-missing': loaded && !serviceLastRun }">
                <span class="mail-dot" aria-hidden="true"></span>{{ loading ? 'Carregant…' : serviceLabel }}
              </p>
            </div>
            <ul class="mail-rules">
              <li><b>Canvis per a avui:</b> surten al cap de 2 minuts (dies feiners, de 8:00 a 15:00).</li>
              <li><b>Canvis per a un altre dia:</b> surten a les 8:00 d’aquell dia.</li>
              <li>Amb més d’un avís el mateix dia, el professor rep un sol correu.</li>
            </ul>
          </div>

          <div class="mail-sender">
            <label>
              <span>Nom del remitent</span>
              <input v-model="config.senderName" type="text" maxlength="120" />
            </label>
            <label>
              <span>Respostes a (opcional)</span>
              <input v-model="config.replyTo" type="email" maxlength="320" placeholder="caps.estudis@iesjosepsuredaiblanes.com" />
            </label>
            <label>
              <span>Les proves van a</span>
              <input
                v-model="config.testEmail"
                type="email"
                maxlength="320"
                :placeholder="viewerEmail || 'adreça del centre'"
                :aria-invalid="testEmailInvalid"
                aria-label="Adreça per a les proves"
              />
              <small v-if="testEmailInvalid" class="is-error">Ha de ser una adreça del centre.</small>
            </label>
          </div>

          <div class="mail-kinds">
            <article
              v-for="item in KINDS"
              :key="item.kind"
              class="mail-template"
              :class="[`is-${item.kind}`, { 'is-off': !config[item.kind].enabled }]"
              :data-mail-template="item.kind"
            >
              <header class="mail-template-head">
                <div>
                  <h3>{{ item.title }}</h3>
                  <p>{{ item.help }}</p>
                </div>
                <label class="mail-switch">
                  <input v-model="config[item.kind].enabled" type="checkbox" role="switch" :aria-label="`Correu actiu: ${item.title}`" />
                  <span class="mail-switch-track" aria-hidden="true"></span>
                  <span>{{ config[item.kind].enabled ? 'Actiu' : 'Desactivat' }}</span>
                </label>
              </header>
              <div class="mail-template-body">
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
                  <dl>
                    <div><dt>Per a</dt><dd>{{ EXAMPLE_NAME }}</dd></div>
                    <div><dt>Assumpte</dt><dd class="mail-preview-subject">{{ preview(item.kind)?.subject }}</dd></div>
                  </dl>
                  <p>{{ preview(item.kind)?.text }}</p>
                </div>
              </div>
              <footer class="mail-template-foot">
                <button type="button" class="ghost" :disabled="!testRecipient || !!testing || saving" @click="sendTest(item.kind)">
                  {{ testing === item.kind ? 'Enviant…' : 'Envia’m una prova' }}
                </button>
                <small v-if="testRecipient">a {{ testRecipient }}</small>
              </footer>
            </article>
          </div>
        </fieldset>

        <div class="mail-actions" :class="{ 'is-dirty': dirty }">
          <button type="button" :disabled="!dirty || saving" @click="save">{{ saving ? 'Desant…' : 'Desa' }}</button>
          <span v-if="dirty && !feedback" class="mail-unsaved">Hi ha canvis sense desar.</span>
          <span v-if="feedback" class="mail-feedback" :class="`is-${feedbackKind}`" role="status" aria-live="polite">{{ feedback }}</span>
        </div>

        <section v-if="mailLists.length" class="mail-recent" aria-labelledby="mail-recent-title">
          <h3 id="mail-recent-title">Darrers correus</h3>
          <template v-for="list in mailLists" :key="list.key">
            <h4>{{ list.title }}</h4>
            <ul :data-mail-list="list.key">
              <li v-for="mail in list.mails" :key="mail.id" :class="`is-${mail.status}`">
                <strong>{{ mail.kind === 'prova' ? mail.email : mail.fields?.nom_complet || mail.email }}</strong>
                <span>{{ mailDetail(mail) }}</span>
                <small>{{ statusLabel(mail) }}</small>
              </li>
            </ul>
          </template>
        </section>
      </section>
    </div>
  </details>
</template>
