import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAIL_CONFIG,
  MAIL_EXAMPLE_FIELDS,
  mailDateFields,
  mailHourFields,
  mailId,
  mailPersonNames,
  mailSendAfter,
  newReleasedAssignments,
  normalizeMailConfig,
  renderMailTemplate,
} from '../../src/modules/guardies/domain/mail.js';

const at = (iso) => mailSendAfter(new Date(iso)).toISOString();

test('entre les 8:00 i les 15:00 d\'un dia feiner el correu surt al cap de 2 minuts', () => {
  assert.equal(at('2026-10-19T10:00:00+02:00'), '2026-10-19T08:02:00.000Z');
  assert.equal(at('2026-10-19T08:00:00+02:00'), '2026-10-19T06:02:00.000Z');
  assert.equal(at('2026-10-19T15:00:00+02:00'), '2026-10-19T13:02:00.000Z');
});

test('fora d\'aquest horari surt a les 8:00 del següent dia feiner', () => {
  assert.equal(at('2026-10-19T07:30:00+02:00'), '2026-10-19T06:00:00.000Z', 'abans de les 8, el mateix dia');
  assert.equal(at('2026-10-19T15:01:00+02:00'), '2026-10-20T06:00:00.000Z', 'a la tarda, l\'endemà');
  assert.equal(at('2026-10-24T11:00:00+02:00'), '2026-10-26T07:00:00.000Z', 'dissabte, dilluns (ja en horari d\'hivern)');
  assert.equal(at('2026-10-23T18:00:00+02:00'), '2026-10-26T07:00:00.000Z', 'divendres al vespre, dilluns a les 8:00');
  assert.equal(at('2027-03-27T12:00:00+01:00'), '2027-03-29T06:00:00.000Z', 'dissabte abans del canvi d\'estiu');
});

test('omple els camps de la plantilla i deixa a la vista els que no existeixen', () => {
  const body = renderMailTemplate(DEFAULT_MAIL_CONFIG.alliberat.body, MAIL_EXAMPLE_FIELDS.alliberat);
  assert.equal(body, 'Benvolgut/da Marina,\n\nSe us ha assignat una guàrdia amb el grup 3ESO-B, com a alliberat/da, el 20/10/2026 a 4a hora.\n\nGràcies.');
  assert.equal(renderMailTemplate('Zona {zona} {zonaa}', { zona: 'Pista' }), 'Zona Pista {zonaa}');
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
  assert.equal(config.pati.body, DEFAULT_MAIL_CONFIG.pati.body);
  assert.deepEqual(config.alliberat, DEFAULT_MAIL_CONFIG.alliberat);
  assert.equal(normalizeMailConfig(null).senderName, DEFAULT_MAIL_CONFIG.senderName);
});

test('cada correu té un identificador estable i vàlid per a Firestore', () => {
  assert.equal(mailId(['2026-10-20', 'alliberat', '91051', '91051|2|12:10|2948044|72473|']), '2026-10-20_alliberat_91051_91051-2-12-10-2948044-72473-');
});
