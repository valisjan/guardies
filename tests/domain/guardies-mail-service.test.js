import test from 'node:test';
import assert from 'node:assert/strict';
import { processMailQueue } from '../../netlify/lib/correus.mjs';

// Firestore en memòria amb la mateixa interfície que netlify/lib/firestore-rest.mjs.
function fakeFirestore(docs) {
  const store = new Map(Object.entries(structuredClone(docs)).map(([path, data]) => [path, { data, version: 1 }]));
  const fails = { read: new Set(), status: new Set() };
  const statuses = [];
  let heartbeats = 0;
  return {
    store, fails, statuses,
    get heartbeats() { return heartbeats; },
    async read(path) {
      if (fails.read.has(path)) throw new Error('Firestore 503');
      return structuredClone(store.get(path)?.data ?? null);
    },
    async pendingMails() {
      return [...store].filter(([path, doc]) => path.startsWith('guardiesCorreus/') && doc.data.status === 'pendent')
        .map(([path, doc]) => ({ ...structuredClone(doc.data), id: path.split('/')[1], documentName: path, updateTime: doc.version }));
    },
    async setStatus(mail, status, reason = '') {
      if (fails.status.has(`${mail.id}:${status}`)) throw new Error('Firestore 503');
      const doc = store.get(mail.documentName);
      if (doc.version !== mail.updateTime) return false;
      doc.data = { ...doc.data, status, reason };
      doc.version += 1;
      mail.updateTime = doc.version;
      statuses.push(`${mail.id}:${status}`);
      return true;
    },
    async heartbeat() { heartbeats += 1; },
  };
}

const NOW = new Date('2026-10-21T10:00:00+02:00');
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const base = {
  courseId: '2026-2027', kind: 'alliberat', template: 'alliberat', date: '2026-10-22', teacherId: '91051',
  email: 'sergio.lopez@iesjosepsuredaiblanes.com', fields: { nom: 'Sergio', grup: '3ESO-B', data: '22/10/2026', hora: '4a hora' },
  check: { absenceId: 'A' }, status: 'pendent', reason: '', sendAfter: ago(1),
};
const world = (mails) => ({
  'cursos/2026-2027/config/guardies-correus': {
    senderName: 'Guàrdies JSB', replyTo: 'caps.estudis@iesjosepsuredaiblanes.com',
    alliberat: { enabled: true, subject: 'Guàrdia el {data} a {hora}', body: 'Benvolgut {nom}, grup {grup}.' },
    pati: { enabled: false, subject: 'Pati {data}', body: 'Zona {zona}' },
  },
  'cursos/2026-2027/guardiesDays/2026-10-22': {
    absenceIds: ['A', 'B', 'C'], cancelledAssignments: ['C'],
    assignments: { A: { teacherId: '91051', source: 'released' }, B: { teacherId: '2', source: 'guard' }, C: { teacherId: '5', source: 'released' } },
  },
  'cursos/2026-2027/guardies/pati': { weekdayTeachers: { 4: [{ teacherId: '7', zoneOverrides: { '2026-10-22': 'zona-2' } }] } },
  ...Object.fromEntries(Object.entries(mails).map(([id, extra]) => [`guardiesCorreus/${id}`, { ...base, ...extra }])),
});
const run = (firestore, send, now = NOW) => processMailQueue({ firestore, send, now, account: 'guardies@iesjosepsuredaiblanes.com' });

test('envia només els correus que ja toquen i que encara són vigents', async () => {
  const firestore = fakeFirestore(world({
    envia: {},
    'encara-no': { sendAfter: new Date(NOW.getTime() + 60_000).toISOString() },
    'ja-no-hi-es': { teacherId: '2', check: { absenceId: 'B' } },
    anul_lada: { teacherId: '5', check: { absenceId: 'C' } },
    passat: { date: '2026-10-01' },
    'pati-desactivat': { kind: 'pati', template: 'pati', teacherId: '7', check: { day: '4', zoneId: 'zona-2' } },
    fora: { email: 'algu@gmail.com' },
    prova: { kind: 'prova', template: 'alliberat', date: '', email: 'admin@iesjosepsuredaiblanes.com' },
  }));
  const sent = [];
  const summary = await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => [message.to, message.subject]), [
    ['sergio.lopez@iesjosepsuredaiblanes.com', 'Guàrdia el 22/10/2026 a 4a hora'],
    ['admin@iesjosepsuredaiblanes.com', '[Prova] Guàrdia el 22/10/2026 a 4a hora'],
  ]);
  assert.deepEqual(sent[0], {
    to: 'sergio.lopez@iesjosepsuredaiblanes.com', subject: 'Guàrdia el 22/10/2026 a 4a hora', text: 'Benvolgut Sergio, grup 3ESO-B.',
    senderName: 'Guàrdies JSB', replyTo: 'caps.estudis@iesjosepsuredaiblanes.com',
  });
  const status = (id) => [firestore.store.get(`guardiesCorreus/${id}`).data.status, firestore.store.get(`guardiesCorreus/${id}`).data.reason];
  assert.deepEqual(status('envia'), ['enviat', '']);
  assert.deepEqual(status('encara-no'), ['pendent', '']);
  assert.deepEqual(status('ja-no-hi-es'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(status('anul_lada'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(status('passat'), ['cancel·lat', 'El dia ja ha passat']);
  assert.deepEqual(status('pati-desactivat'), ['cancel·lat', 'Correu desactivat']);
  assert.deepEqual(status('fora'), ['error', 'Adreça de fora del centre']);
  assert.equal(summary.enviats, 2);

  await run(firestore, async (message) => sent.push(message));
  assert.equal(sent.length, 2, 'una segona revisió no torna a enviar res');
});

test('el canvi de zona de pati només surt si la zona encara és la mateixa', async () => {
  const docs = world({
    pati: { kind: 'pati', template: 'pati', teacherId: '7', check: { day: '4', zoneId: 'zona-2' }, fields: { zona: 'Porxada', data: '22/10/2026' } },
    'pati-canviat': { kind: 'pati', template: 'pati', teacherId: '7', check: { day: '4', zoneId: 'zona-3' } },
  });
  docs['cursos/2026-2027/config/guardies-correus'].pati.enabled = true;
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => message.subject), ['Pati 22/10/2026']);
  assert.equal(firestore.store.get('guardiesCorreus/pati-canviat').data.status, 'cancel·lat');
});

test('sense configuració desada fa servir els textos per defecte', async () => {
  const docs = world({ envia: {} });
  delete docs['cursos/2026-2027/config/guardies-correus'];
  const sent = [];
  await run(fakeFirestore(docs), async (message) => sent.push(message));
  assert.equal(sent[0].text, 'Benvolgut/da Sergio,\n\nSe us ha assignat una guàrdia amb el grup 3ESO-B, com a alliberat/da, el 22/10/2026 a 4a hora.\n\nGràcies.');
  assert.equal(sent[0].replyTo, '');
});

test('cada correu s\'envia com a molt una vegada encara que alguna cosa falli', async () => {
  const firestore = fakeFirestore(world({
    'gmail-falla': {},
    'marca-falla': { email: 'marca.falla@iesjosepsuredaiblanes.com' },
    'sense-firestore': { date: '2026-10-23' },
  }));
  firestore.fails.read.add('cursos/2026-2027/guardiesDays/2026-10-23');
  firestore.fails.status.add('marca-falla:enviat');
  const sent = [];
  const send = async (message) => {
    if (message.to.startsWith('sergio')) throw new Error('Daily user sending limit exceeded');
    sent.push(message);
  };
  await run(firestore, send);
  const doc = (id) => firestore.store.get(`guardiesCorreus/${id}`).data;
  assert.deepEqual([doc('gmail-falla').status, doc('gmail-falla').reason], ['error', 'Daily user sending limit exceeded']);
  assert.equal(doc('marca-falla').status, 'enviant', 'enviat però sense poder-ho marcar: queda «enviant»');
  assert.equal(doc('sense-firestore').status, 'pendent', 'si no es pot comprovar, es torna a provar');
  await run(firestore, send);
  await run(firestore, send);
  assert.equal(sent.length, 1, 'no es torna a enviar mai');
});

test('si Guàrdies el torna a programar abans d\'enviar-lo, no s\'envia el contingut vell', async () => {
  const firestore = fakeFirestore(world({ envia: {} }));
  const original = firestore.setStatus;
  firestore.setStatus = async (mail, status, reason) => {
    // Just abans de reservar-lo, Guàrdies el reescriu (nova versió del document).
    if (status === 'enviant') firestore.store.get(mail.documentName).version += 1;
    return original(mail, status, reason);
  };
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  assert.equal(sent.length, 0);
  assert.equal(firestore.store.get('guardiesCorreus/envia').data.status, 'pendent');
});

test('deixa el senyal de funcionament cada 10 minuts', async () => {
  const firestore = fakeFirestore(world({}));
  await run(firestore, async () => {}, new Date('2026-10-21T10:00:00+02:00'));
  await run(firestore, async () => {}, new Date('2026-10-21T10:01:00+02:00'));
  await run(firestore, async () => {}, new Date('2026-10-21T10:10:00+02:00'));
  assert.equal(firestore.heartbeats, 2);
});
