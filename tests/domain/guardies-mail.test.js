import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAIL_CONFIG,
  MAIL_EXAMPLE_FIELDS,
  composeMail,
  isSchoolEmail,
  mailDateFields,
  mailDueAt,
  mailHourFields,
  mailId,
  mailPersonNames,
  mailSendAfter,
  newReleasedAssignments,
  normalizeMailConfig,
  renderMailTemplate,
} from '../../src/modules/guardies/domain/mail.js';

const at = (iso, date = '') => mailSendAfter(new Date(iso), date).toISOString();

test('un canvi per a avui, entre les 8:00 i les 15:00 d\'un dia feiner, surt al cap de 2 minuts', () => {
  assert.equal(at('2026-10-19T10:00:00+02:00', '2026-10-19'), '2026-10-19T08:02:00.000Z');
  assert.equal(at('2026-10-19T08:00:00+02:00', '2026-10-19'), '2026-10-19T06:02:00.000Z');
  assert.equal(at('2026-10-19T15:00:00+02:00', '2026-10-19'), '2026-10-19T13:02:00.000Z');
  assert.equal(at('2026-10-19T10:00:00+02:00'), '2026-10-19T08:02:00.000Z', 'una prova, sense dia, també');
});

test('un canvi per a avui fet abans de les 8:00 surt a les 8:00', () => {
  assert.equal(at('2026-10-19T07:30:00+02:00', '2026-10-19'), '2026-10-19T06:00:00.000Z');
});

test('un canvi per a un altre dia surt a les 8:00 d\'aquell dia, es faci quan es faci', () => {
  assert.equal(at('2026-10-19T10:00:00+02:00', '2026-10-20'), '2026-10-20T06:00:00.000Z', 'per a demà, demà a les 8:00');
  assert.equal(at('2026-10-19T18:00:00+02:00', '2026-10-20'), '2026-10-20T06:00:00.000Z', 'fet a la tarda, igual');
  assert.equal(at('2026-10-19T10:00:00+02:00', '2026-10-23'), '2026-10-23T06:00:00.000Z', 'per a divendres, divendres a les 8:00');
  assert.equal(at('2026-10-23T12:00:00+02:00', '2026-10-26'), '2026-10-26T07:00:00.000Z', 'per a dilluns (ja en horari d\'hivern)');
  assert.equal(at('2027-03-26T12:00:00+01:00', '2027-03-29'), '2027-03-29T06:00:00.000Z', 'per a dilluns, després del canvi d\'estiu');
});

test('un canvi per a avui fet després de l\'horari queda per al següent dia feiner (i el servei el descarta)', () => {
  assert.equal(at('2026-10-19T15:01:00+02:00', '2026-10-19'), '2026-10-20T06:00:00.000Z');
  assert.equal(at('2026-10-23T18:00:00+02:00', '2026-10-23'), '2026-10-26T07:00:00.000Z');
});

test('un correu mai surt abans de les 8:00 del seu dia, encara que s\'hagi programat abans', () => {
  const due = (mail) => mailDueAt(mail).toISOString();
  assert.equal(due({ date: '2026-10-29', sendAfter: '2026-10-28T07:54:00.000Z' }), '2026-10-29T07:00:00.000Z');
  assert.equal(due({ date: '2026-10-28', sendAfter: '2026-10-28T09:02:00.000Z' }), '2026-10-28T09:02:00.000Z');
  assert.equal(due({ date: '', sendAfter: '2026-10-28T09:02:00.000Z' }), '2026-10-28T09:02:00.000Z', 'proves');
});

test('omple els camps de la plantilla i deixa a la vista els que no existeixen', () => {
  assert.equal(renderMailTemplate('Hola {nom}', MAIL_EXAMPLE_FIELDS.alliberat), 'Hola Marina');
  assert.equal(renderMailTemplate('Zona {zona} {zonaa}', { zona: 'Pista' }), 'Zona Pista {zonaa}');
});

test('un correu és salutació, avís i comiat', () => {
  const mail = composeMail(DEFAULT_MAIL_CONFIG, [{ kind: 'alliberat', fields: MAIL_EXAMPLE_FIELDS.alliberat }]);
  assert.deepEqual(mail, {
    subject: 'Guàrdia com a alliberat/da el 20/10/2026 a 4a hora',
    text: 'Benvolgut/da Marina,\n\nSe us ha assignat una guàrdia amb el grup 3ESO-B, com a alliberat/da, el 20/10/2026 a 4a hora.\n\nGràcies.',
  });
});

test('diversos avisos del mateix dia van en un sol correu, per ordre d\'hora', () => {
  const later = { ...MAIL_EXAMPLE_FIELDS.alliberat, hora: '6a hora', horari: '13:05', grup: '4ESO-A' };
  const early = { ...MAIL_EXAMPLE_FIELDS.alliberat, hora: '1a hora', horari: '8:00', grup: '1ESO-C' };
  const mail = composeMail(DEFAULT_MAIL_CONFIG, [
    { kind: 'alliberat', fields: later },
    { kind: 'pati', fields: MAIL_EXAMPLE_FIELDS.pati },
    { kind: 'alliberat', fields: early },
  ]);
  assert.equal(mail.subject, 'Avisos de guàrdies per al dimarts 20/10/2026');
  assert.equal(mail.text, [
    'Benvolgut/da Marina,',
    'Se us ha assignat una guàrdia amb el grup 1ESO-C, com a alliberat/da, el 20/10/2026 a 1a hora.',
    'Se us ha assignat la zona Porxada de guàrdia de pati el 20/10/2026, en lloc de la vostra zona habitual (Pista).',
    'Se us ha assignat una guàrdia amb el grup 4ESO-A, com a alliberat/da, el 20/10/2026 a 6a hora.',
    'Gràcies.',
  ].join('\n\n'));
  const bare = composeMail({ ...DEFAULT_MAIL_CONFIG, greeting: '', closing: ' ' }, [{ kind: 'pati', fields: MAIL_EXAMPLE_FIELDS.pati }]);
  assert.equal(bare.text, 'Se us ha assignat la zona Porxada de guàrdia de pati el 20/10/2026, en lloc de la vostra zona habitual (Pista).');
});

test('les adreces del centre són les dels dos dominis', () => {
  assert.ok(isSchoolEmail('jaerustes@iessureda.com'));
  assert.ok(isSchoolEmail('Marina.Adell@iesjosepsuredaiblanes.com'));
  assert.ok(!isSchoolEmail('algu@gmail.com'));
  assert.ok(!isSchoolEmail('iessureda.com'));
});

test('el nom del professorat es mostra en minúscules i amb el nom davant', () => {
  assert.deepEqual(mailPersonNames('LÓPEZ GARCÍA, SERGIO'), { nom: 'Sergio', nom_complet: 'Sergio López García' });
  assert.deepEqual(mailPersonNames('FERRER DE LA TORRE, MARIA DEL MAR'), { nom: 'Maria del Mar', nom_complet: 'Maria del Mar Ferrer de la Torre' });
  assert.deepEqual(mailPersonNames('Adell Domènech, Marina'), { nom: 'Marina', nom_complet: 'Marina Adell Domènech' });
  assert.deepEqual(mailPersonNames('Professor Matemàtiques'), { nom: 'Professor Matemàtiques', nom_complet: 'Professor Matemàtiques' });
  assert.deepEqual(mailPersonNames(''), { nom: '', nom_complet: '' });
});

test('data, dia i hora de classe com els escriu el centre', () => {
  assert.deepEqual(mailDateFields('2026-10-20'), { data: '20/10/2026', dia: 'dimarts' });
  const hours = ['8:00', '8:55', '9:50', 'PATI', '11:15', '12:10'];
  assert.deepEqual(mailHourFields('11:15', hours), { hora: '4a hora', horari: '11:15' });
  assert.deepEqual(mailHourFields('8:00', hours), { hora: '1a hora', horari: '8:00' });
  assert.equal(mailHourFields('PATI', hours).hora, 'l\'hora del pati');
});

test('només compten les assignacions noves com a alliberat/da', () => {
  const previous = {
    assignments: {
      a: { teacherId: '1', source: 'released' },
      b: { teacherId: '2', source: 'guard' },
      c: { teacherId: '3', source: 'released' },
    },
    cancelledAssignments: ['c'],
  };
  const next = {
    assignments: {
      a: { teacherId: '1', source: 'released' },
      b: { teacherId: '2', source: 'released' },
      c: { teacherId: '3', source: 'released' },
      d: { teacherId: '4', source: 'guard' },
      e: { teacherId: '5', source: 'released' },
      f: { teacherId: '6', source: 'released' },
    },
    cancelledAssignments: ['f'],
  };
  assert.deepEqual(newReleasedAssignments(previous, next), [
    { absenceId: 'b', teacherId: '2' },
    { absenceId: 'c', teacherId: '3' },
    { absenceId: 'e', teacherId: '5' },
  ]);
  assert.deepEqual(newReleasedAssignments(null, { assignments: { x: { teacherId: '9', source: 'released' } } }), [
    { absenceId: 'x', teacherId: '9' },
  ]);
});

test('la configuració sempre té les dues plantilles i un remitent vàlid', () => {
  const config = normalizeMailConfig({ replyTo: 'no és un correu', pati: { enabled: false, subject: 'Pati' } });
  assert.equal(config.replyTo, '');
  assert.equal(config.pati.enabled, false);
  assert.equal(config.pati.subject, 'Pati');
  assert.equal(config.pati.notice, DEFAULT_MAIL_CONFIG.pati.notice);
  assert.deepEqual(config.alliberat, DEFAULT_MAIL_CONFIG.alliberat);
  assert.equal(normalizeMailConfig(null).senderName, DEFAULT_MAIL_CONFIG.senderName);
});

test('l\'enviament al professorat està aturat fins que algú l\'activa', () => {
  assert.equal(normalizeMailConfig({}).active, false);
  assert.equal(normalizeMailConfig({ active: 'sí' }).active, false);
  assert.equal(normalizeMailConfig({ active: true }).active, true);
});

test('les proves només poden anar a una adreça del centre', () => {
  assert.equal(normalizeMailConfig({ testEmail: ' JaeRustes@iessureda.com ' }).testEmail, 'jaerustes@iessureda.com');
  assert.equal(normalizeMailConfig({ testEmail: 'algu@gmail.com' }).testEmail, '');
});

test('cada correu té un identificador estable i vàlid per a Firestore', () => {
  assert.equal(mailId(['2026-10-20', 'alliberat', '91051', '91051|2|12:10|2948044|72473|']), '2026-10-20_alliberat_91051_91051-2-12-10-2948044-72473-');
});
