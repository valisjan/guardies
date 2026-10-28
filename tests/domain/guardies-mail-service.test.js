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
    async setStatus(mail, status, reason = '', now = new Date(), extra = {}) {
      if (fails.status.has(`${mail.id}:${status}`)) throw new Error('Firestore 503');
      const doc = store.get(mail.documentName);
      if (doc.version !== mail.updateTime) return false;
      doc.data = { ...doc.data, status, reason, ...extra };
      doc.version += 1;
      mail.updateTime = doc.version;
      statuses.push(`${mail.id}:${status}`);
      return true;
    },
    async teacherRecords(courseId, email) {
      return [...store].filter(([path, doc]) => path.startsWith(`cursos/${courseId}/professors/`) && doc.data.email === email)
        .map(([, doc]) => structuredClone(doc.data));
    },
    async heartbeat() { heartbeats += 1; },
  };
}

// Dimecres 21/10/2026 a les 10:00.
const NOW = new Date('2026-10-21T10:00:00+02:00');
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const base = {
  courseId: '2026-2027', kind: 'alliberat', template: 'alliberat', date: '2026-10-21', teacherId: '91051',
  email: 'sergio.lopez@iesjosepsuredaiblanes.com', fields: { nom: 'Sergio', grup: '3ESO-B', data: '21/10/2026', dia: 'dimecres', hora: '4a hora', horari: '11:15' },
  check: { absenceId: 'A' }, status: 'pendent', reason: '', sendAfter: ago(1),
};
const world = (mails) => ({
  'cursos/2026-2027/config/guardies-correus': {
    active: true,
    senderName: 'Guàrdies JSB', replyTo: 'caps.estudis@iesjosepsuredaiblanes.com',
    alliberat: { enabled: true, subject: 'Guàrdia el {data} a {hora}', body: 'Benvolgut {nom},\n\nGrup {grup} a {hora}.' },
    pati: { enabled: false, subject: 'Pati {data}', body: 'Benvolgut {nom},\n\nZona {zona}.' },
  },
  'cursos/2026-2027/guardiesDays/2026-10-21': {
    absenceIds: ['A', 'B', 'C', 'D'], cancelledAssignments: ['C'],
    assignments: {
      A: { teacherId: '91051', source: 'released' },
      B: { teacherId: '2', source: 'guard' },
      C: { teacherId: '5', source: 'released' },
      D: { teacherId: '91051', source: 'released' },
    },
  },
  'cursos/2026-2027/guardiesDays/2026-10-22': {
    absenceIds: ['E'], cancelledAssignments: [], assignments: { E: { teacherId: '91051', source: 'released' } },
  },
  'cursos/2026-2027/guardies/pati': {
    weekdayTeachers: { 3: [{ teacherId: '7', zoneOverrides: { '2026-10-21': 'zona-2' } }, { teacherId: '91051', zoneOverrides: { '2026-10-21': 'zona-2' } }] },
  },
  ...Object.fromEntries(Object.entries(mails).map(([id, extra]) => [`guardiesCorreus/${id}`, { ...base, ...extra }])),
});
const enablePatio = (docs) => {
  docs['cursos/2026-2027/config/guardies-correus'].pati.enabled = true;
  return docs;
};
const run = (firestore, send, now = NOW) => processMailQueue({ firestore, send, now, account: 'guardies@iesjosepsuredaiblanes.com' });
const statusOf = (firestore, id) => {
  const { status, reason } = firestore.store.get(`guardiesCorreus/${id}`).data;
  return [status, reason];
};

test('envia només els correus que ja toquen i que encara són vigents', async () => {
  const firestore = fakeFirestore(world({
    envia: {},
    'encara-no': { sendAfter: new Date(NOW.getTime() + 60_000).toISOString() },
    'ja-no-hi-es': { teacherId: '2', email: 'b@iesjosepsuredaiblanes.com', check: { absenceId: 'B' } },
    anul_lada: { teacherId: '5', email: 'c@iesjosepsuredaiblanes.com', check: { absenceId: 'C' } },
    passat: { date: '2026-10-01' },
    'pati-desactivat': { kind: 'pati', template: 'pati', teacherId: '7', check: { day: '3', zoneId: 'zona-2' } },
    fora: { email: 'algu@gmail.com' },
    prova: { kind: 'prova', template: 'alliberat', date: '', email: 'jaerustes@iessureda.com' },
  }));
  const sent = [];
  const summary = await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => [message.to, message.subject]), [
    ['sergio.lopez@iesjosepsuredaiblanes.com', 'Guàrdia el 21/10/2026 a 4a hora'],
    ['jaerustes@iessureda.com', '[Prova] Guàrdia el 21/10/2026 a 4a hora'],
  ]);
  assert.deepEqual(sent[0], {
    to: 'sergio.lopez@iesjosepsuredaiblanes.com', subject: 'Guàrdia el 21/10/2026 a 4a hora', text: 'Benvolgut Sergio,\n\nGrup 3ESO-B a 4a hora.',
    senderName: 'Guàrdies JSB', replyTo: 'caps.estudis@iesjosepsuredaiblanes.com',
  });
  assert.deepEqual(statusOf(firestore, 'envia'), ['enviat', '']);
  assert.deepEqual(statusOf(firestore, 'encara-no'), ['pendent', '']);
  assert.deepEqual(statusOf(firestore, 'ja-no-hi-es'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(statusOf(firestore, 'anul_lada'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(statusOf(firestore, 'passat'), ['cancel·lat', 'El dia ja ha passat']);
  assert.deepEqual(statusOf(firestore, 'pati-desactivat'), ['cancel·lat', 'Correu desactivat']);
  assert.deepEqual(statusOf(firestore, 'fora'), ['error', 'Adreça de fora del centre']);
  assert.equal(summary.enviats, 2);
  assert.equal(summary.correus, 2);

  await run(firestore, async (message) => sent.push(message));
  assert.equal(sent.length, 2, 'una segona revisió no torna a enviar res');
});

test('els avisos d\'un altre dia esperen fins a les 8:00 d\'aquell dia', async () => {
  // Programat amb la regla antiga: per a demà, però «ja tocava».
  const firestore = fakeFirestore(world({ dema: { date: '2026-10-22', check: { absenceId: 'E' } } }));
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-22T07:59:00+02:00'));
  assert.equal(sent.length, 0);
  assert.deepEqual(statusOf(firestore, 'dema'), ['pendent', '']);
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-22T08:00:00+02:00'));
  assert.equal(sent.length, 1);
  assert.deepEqual(statusOf(firestore, 'dema'), ['enviat', '']);
});

test('un avís previst que ja no cal s\'anul·la abans d\'hora, a la revisió de cada 5 minuts', async () => {
  // Per a demà, però la guàrdia E ara la fa un altre professor.
  const docs = world({ 'ja-no-cal': { date: '2026-10-22', teacherId: '5', check: { absenceId: 'E' } }, 'encara-cal': { date: '2026-10-22', check: { absenceId: 'E' } } });
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-21T10:01:00+02:00'));
  assert.deepEqual(statusOf(firestore, 'ja-no-cal'), ['pendent', ''], 'entre revisions no es llegeix res');
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-21T10:05:00+02:00'));
  assert.deepEqual(statusOf(firestore, 'ja-no-cal'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(statusOf(firestore, 'encara-cal'), ['pendent', '']);
  assert.equal(sent.length, 0);
});

test('mentre l\'enviament està aturat, un avís previst i vigent es manté fins a la seva hora', async () => {
  const docs = world({ dema: { date: '2026-10-22', check: { absenceId: 'E' } } });
  docs['cursos/2026-2027/config/guardies-correus'].active = false;
  const firestore = fakeFirestore(docs);
  await run(firestore, async () => {}, new Date('2026-10-21T10:05:00+02:00'));
  assert.deepEqual(statusOf(firestore, 'dema'), ['pendent', '']);
  await run(firestore, async () => {}, new Date('2026-10-22T08:00:00+02:00'));
  assert.deepEqual(statusOf(firestore, 'dema'), ['cancel·lat', 'Enviament al professorat aturat']);
});

test('no s\'escriu a una adreça que només és d\'una fitxa de professorat de baixa', async () => {
  // Cas real: l'avís de Capellà (plaça TORR) s'havia programat amb el correu de Torres, de baixa.
  const docs = world({
    'a-baixa': { email: 'atorres@iesjosepsuredaiblanes.com' },
    'a-qui-hi-es': { email: 'acapella@iesjosepsuredaiblanes.com', check: { absenceId: 'D' } },
  });
  docs['cursos/2026-2027/professors/1syXb'] = { codiUntis: 'TORR', email: 'atorres@iesjosepsuredaiblanes.com', motiuBaixa: 'Baixa', eliminatDelFull: true };
  docs['cursos/2026-2027/professors/TORR'] = { codiUntis: 'TORR', email: 'acapella@iesjosepsuredaiblanes.com', eliminatDelFull: false };
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => message.to), ['acapella@iesjosepsuredaiblanes.com']);
  assert.deepEqual(statusOf(firestore, 'a-baixa'), ['cancel·lat', 'Adreça d’una fitxa de professorat de baixa']);
});

test('un avís programat a mà surt encara que l\'enviament estigui aturat, si continua vigent', async () => {
  const docs = world({
    manual: { manual: true, date: '2026-10-22', check: { absenceId: 'E' }, sendAfter: '2026-10-22T06:00:00.000Z' },
    'manual-ja-no-cal': { manual: true, date: '2026-10-22', teacherId: '5', email: 'c@iesjosepsuredaiblanes.com', check: { absenceId: 'E' }, sendAfter: '2026-10-22T06:00:00.000Z' },
    normal: { date: '2026-10-22', email: 'altre@iesjosepsuredaiblanes.com', check: { absenceId: 'E' } },
  });
  docs['cursos/2026-2027/config/guardies-correus'].active = false;
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-22T08:00:00+02:00'));
  assert.deepEqual(sent.map((message) => message.to), ['sergio.lopez@iesjosepsuredaiblanes.com']);
  assert.deepEqual(statusOf(firestore, 'manual'), ['enviat', '']);
  assert.deepEqual(statusOf(firestore, 'manual-ja-no-cal'), ['cancel·lat', 'Ja no és vigent']);
  assert.deepEqual(statusOf(firestore, 'normal'), ['cancel·lat', 'Enviament al professorat aturat']);
});

test('les proves surten a qualsevol hora, també el cap de setmana', async () => {
  const firestore = fakeFirestore(world({ prova: { kind: 'prova', template: 'alliberat', date: '', email: 'jaerustes@iessureda.com', sendAfter: '2026-10-24T20:00:00.000Z' } }));
  const sent = [];
  await run(firestore, async (message) => sent.push(message), new Date('2026-10-24T22:01:00+02:00'));
  assert.deepEqual(sent.map((message) => message.to), ['jaerustes@iessureda.com']);
});

test('amb l\'enviament al professorat aturat, els avisos no surten i les proves sí', async () => {
  const docs = world({
    avis: {},
    prova: { kind: 'prova', template: 'pati', date: '', email: 'jaerustes@iessureda.com', fields: { nom: 'Marina', zona: 'Porxada', data: '20/10/2026' } },
  });
  docs['cursos/2026-2027/config/guardies-correus'].active = false;
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => [message.to, message.subject, message.text]), [
    ['jaerustes@iessureda.com', '[Prova] Pati 20/10/2026', 'Benvolgut Marina,\n\nZona Porxada.'],
  ]);
  assert.deepEqual(statusOf(firestore, 'avis'), ['cancel·lat', 'Enviament al professorat aturat']);
});

test('sense configuració desada no s\'envia res al professorat', async () => {
  const docs = world({ envia: {} });
  delete docs['cursos/2026-2027/config/guardies-correus'];
  const firestore = fakeFirestore(docs);
  const sent = [];
  await run(firestore, async (message) => sent.push(message));
  assert.equal(sent.length, 0);
  assert.deepEqual(statusOf(firestore, 'envia'), ['cancel·lat', 'Enviament al professorat aturat']);
});

test('els avisos d\'un professor per al mateix dia van en un sol correu', async () => {
  const firestore = fakeFirestore(enablePatio(world({
    sisena: { check: { absenceId: 'D' }, fields: { ...base.fields, hora: '6a hora', horari: '13:05', grup: '4ESO-A' } },
    quarta: {},
    pati: { kind: 'pati', template: 'pati', check: { day: '3', zoneId: 'zona-2' }, fields: { ...base.fields, zona: 'Porxada' } },
    altre: { kind: 'pati', template: 'pati', teacherId: '7', email: 'gabriel@iesjosepsuredaiblanes.com', check: { day: '3', zoneId: 'zona-2' }, fields: { nom: 'Gabriel', zona: 'Porxada', data: '21/10/2026' } },
  })));
  const sent = [];
  const summary = await run(firestore, async (message) => sent.push(message));
  assert.deepEqual(sent.map((message) => message.to), ['sergio.lopez@iesjosepsuredaiblanes.com', 'gabriel@iesjosepsuredaiblanes.com']);
  assert.equal(sent[0].subject, 'Avisos de guàrdies per al dimecres 21/10/2026');
  assert.equal(sent[0].text, 'Benvolgut Sergio,\n\nZona Porxada.\n\nGrup 3ESO-B a 4a hora.\n\nGrup 4ESO-A a 6a hora.');
  assert.equal(sent[1].subject, 'Pati 21/10/2026');
  for (const id of ['sisena', 'quarta', 'pati', 'altre']) assert.deepEqual(statusOf(firestore, id), ['enviat', '']);
  // Cada avís guarda el correu tal com ha sortit, per veure'l al registre.
  for (const id of ['sisena', 'quarta', 'pati']) {
    const { subject, text } = firestore.store.get(`guardiesCorreus/${id}`).data;
    assert.deepEqual({ subject, text }, { subject: sent[0].subject, text: sent[0].text });
  }
  assert.equal(summary.enviats, 4);
  assert.equal(summary.correus, 2);
});

test('cada avís s\'envia com a molt una vegada encara que alguna cosa falli', async () => {
  const firestore = fakeFirestore(world({
    'gmail-falla': {},
    'marca-falla': { email: 'marca.falla@iesjosepsuredaiblanes.com' },
    'sense-firestore': { courseId: 'altre' },
  }));
  firestore.fails.read.add('cursos/altre/config/guardies-correus');
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
