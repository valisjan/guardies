<script setup>
import { computed, reactive, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGuardiesStore } from '../stores/guardies.js';
import { friendlyError } from '../../../src/utils/friendlyError.js';
import {
  DEFAULT_MAIL_CONFIG,
  MAIL_COMMON_FIELDS,
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
const STATUS = { pendent: 'Pendent', enviant: 'Enviant', enviat: 'Enviat', 'cancel·lat': 'No enviat', error: 'Error' };
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
// Camps de text de cada bloc i l'últim que ha tingut el focus: els botons de camp
// l'hi insereixen on hi ha el cursor.
const inputs = {};
const focused = reactive({ alliberat: 'notice', pati: 'notice', common: 'greeting' });

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
const combinedPreview = computed(() => composeMail(config, KINDS.map(({ kind }) => ({ kind, fields: MAIL_EXAMPLE_FIELDS[kind] }))));

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

// group: 'alliberat' | 'pati' (assumpte i avís) o 'common' (salutació, comiat, assumpte comú).
function target(group) {
  const key = focused[group];
  return group === 'common' ? { object: config, key } : { object: config[group], key };
}

function insertField(group, field) {
  const { object, key } = target(group);
  const input = inputs[`${group}.${key}`];
  const value = object[key];
  const start = input?.selectionStart ?? value.length;
  const end = input?.selectionEnd ?? value.length;
  object[key] = `${value.slice(0, start)}{${field}}${value.slice(end)}`;
  requestAnimationFrame(() => {
    input?.focus();
    input?.setSelectionRange(start + field.length + 2, start + field.length + 2);
  });
}

// template: 'alliberat', 'pati' o 'combinat' (un correu amb els dos avisos).
async function sendTest(template) {
  const recipient = testRecipient.value;
  if (!recipient) return;
  testing.value = template;
  feedback.value = '';
  try {
    if (dirty.value) await save();
    const now = new Date();
    await queueGuardiesMails(courseId.value, [{
      id: mailId([now.toISOString(), 'prova', template]),
      kind: 'prova',
      template,
      date: '',
      teacherId: '',
      email: recipient,
      fields: MAIL_EXAMPLE_FIELDS[template] || MAIL_EXAMPLE_FIELDS.alliberat,
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
                  <small v-if="config.active">Els avisos arriben al professorat.</small>
                  <small v-else>No s’envia res al professorat; les proves sí. Els avisos surten a «Darrers correus» com a no enviats.</small>
                </span>
              </label>
              <p class="mail-service" :class="{ 'is-missing': loaded && !serviceLastRun }">
                <span class="mail-dot" aria-hidden="true"></span>{{ loading ? 'Carregant…' : serviceLabel }}
              </p>
            </div>
            <div class="mail-rules">
              <strong>Quan surt cada correu</strong>
              <ul>
                <li><b>Canvis per a avui:</b> al cap de 2 minuts, els dies feiners de 8:00 a 15:00.</li>
                <li><b>Canvis per a un altre dia:</b> a les 8:00 d’aquell dia.</li>
                <li>Si un professor té més d’un avís per al mateix dia, rep un sol correu.</li>
                <li>Abans d’enviar-lo es comprova que el canvi continua vigent.</li>
              </ul>
            </div>
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
                  <input
                    v-model="config[item.kind].subject"
                    :ref="(node) => { inputs[`${item.kind}.subject`] = node; }" @focus="focused[item.kind] = 'subject'"
                    type="text"
                    maxlength="200"
                    :aria-label="`Assumpte: ${item.title}`"
                  />
                </label>
                <label>
                  <span>Avís</span>
                  <textarea
                    v-model="config[item.kind].notice"
                    :ref="(node) => { inputs[`${item.kind}.notice`] = node; }" @focus="focused[item.kind] = 'notice'"
                    rows="3"
                    maxlength="2000"
                    :aria-label="`Avís: ${item.title}`"
                  ></textarea>
                </label>
                <div class="mail-fields" :aria-label="`Camps: ${item.title}`">
                  <span>Camps:</span>
                  <button
                    v-for="[field, label] in MAIL_FIELDS[item.kind]"
                    :key="field"
                    type="button"
                    :title="label"
                    @mousedown.prevent
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
                  {{ testing === item.kind ? 'Enviant…' : 'Envia una prova' }}
                </button>
                <small v-if="testRecipient">a {{ testRecipient }}</small>
              </footer>
            </article>
          </div>

          <section class="mail-common" aria-labelledby="mail-common-title">
            <div class="mail-common-settings">
              <h3 id="mail-common-title">Comú a tots els correus</h3>
              <div class="mail-common-grid">
                <label>
                  <span>Nom del remitent</span>
                  <input v-model="config.senderName" type="text" maxlength="120" />
                </label>
                <label>
                  <span>Respostes a (opcional)</span>
                  <input v-model="config.replyTo" type="email" maxlength="320" placeholder="caps.estudis@iesjosepsuredaiblanes.com" />
                </label>
                <label>
                  <span>Salutació</span>
                  <input v-model="config.greeting" :ref="(node) => { inputs['common.greeting'] = node; }" @focus="focused.common = 'greeting'" type="text" maxlength="500" aria-label="Salutació" />
                </label>
                <label>
                  <span>Comiat</span>
                  <input v-model="config.closing" :ref="(node) => { inputs['common.closing'] = node; }" @focus="focused.common = 'closing'" type="text" maxlength="1000" aria-label="Comiat" />
                </label>
                <label class="is-wide">
                  <span>Assumpte quan hi ha més d’un avís el mateix dia</span>
                  <input v-model="config.combinedSubject" :ref="(node) => { inputs['common.combinedSubject'] = node; }" @focus="focused.common = 'combinedSubject'" type="text" maxlength="200" aria-label="Assumpte amb més d’un avís" />
                </label>
              </div>
              <div class="mail-fields" aria-label="Camps comuns">
                <span>Camps:</span>
                <button
                  v-for="[field, label] in MAIL_COMMON_FIELDS"
                  :key="field"
                  type="button"
                  :title="label"
                  @mousedown.prevent
                  @click="insertField('common', field)"
                >{{ token(field) }}</button>
              </div>
              <label class="mail-test-address">
                <span>Les proves van a</span>
                <input
                  v-model="config.testEmail"
                  type="email"
                  maxlength="320"
                  :placeholder="viewerEmail || 'adreça del centre'"
                  :aria-invalid="testEmailInvalid"
                  aria-label="Adreça per a les proves"
                />
                <small :class="{ 'is-error': testEmailInvalid }">
                  {{ testEmailInvalid ? 'Ha de ser una adreça del centre (@iesjosepsuredaiblanes.com o @iessureda.com).' : `Si és buit, a la teva adreça${viewerEmail ? ` (${viewerEmail})` : ''}.` }}
                </small>
              </label>
            </div>
            <div class="mail-common-preview">
              <h3>Amb dos avisos el mateix dia</h3>
              <div class="mail-preview" aria-label="Previsualització amb dos avisos">
                <dl>
                  <div><dt>Per a</dt><dd>{{ EXAMPLE_NAME }}</dd></div>
                  <div><dt>Assumpte</dt><dd class="mail-preview-subject">{{ combinedPreview?.subject }}</dd></div>
                </dl>
                <p>{{ combinedPreview?.text }}</p>
              </div>
              <div class="mail-template-foot">
                <button type="button" class="ghost" :disabled="!testRecipient || !!testing || saving" @click="sendTest('combinat')">
                  {{ testing === 'combinat' ? 'Enviant…' : 'Envia una prova' }}
                </button>
                <small v-if="testRecipient">a {{ testRecipient }}</small>
              </div>
            </div>
          </section>
        </fieldset>

        <div class="mail-actions" :class="{ 'is-dirty': dirty }">
          <button type="button" :disabled="!dirty || saving" @click="save">{{ saving ? 'Desant…' : 'Desa' }}</button>
          <span v-if="dirty && !feedback" class="mail-unsaved">Hi ha canvis sense desar.</span>
          <span v-if="feedback" class="mail-feedback" :class="`is-${feedbackKind}`" role="status" aria-live="polite">{{ feedback }}</span>
        </div>

        <section v-if="recent.length" class="mail-recent" aria-labelledby="mail-recent-title">
          <h3 id="mail-recent-title">Darrers correus</h3>
          <ul>
            <li v-for="mail in recent" :key="mail.id" :class="`is-${mail.status === 'cancel·lat' ? 'cancelled' : mail.status}`">
              <strong>{{ mail.kind === 'prova' ? mail.email : mail.fields?.nom_complet || mail.email }}</strong>
              <span>{{ KIND_LABELS[mail.kind] || mail.kind }}{{ mail.kind === 'prova' && mail.template === 'combinat' ? ' · dos avisos' : '' }}{{ mail.kind !== 'prova' && mail.fields?.data ? ` · ${mail.fields.data}` : '' }}{{ mail.kind !== 'prova' && mail.fields?.hora ? ` · ${mail.fields.hora}` : '' }}{{ mail.kind !== 'prova' && mail.fields?.zona ? ` · ${mail.fields.zona}` : '' }}</span>
              <small>{{ statusLabel(mail) }}</small>
            </li>
          </ul>
        </section>
      </section>
    </div>
  </details>
</template>
