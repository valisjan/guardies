import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classroomPartnerForAbsence,
  completeGuardDutyHours,
  dateForXmlDayInSameWeek,
  groupTeachingBlocks,
  isTeacherAbsentAtSlot,
  mergeSharedClassroomAbsences,
  releasedTeachingBlocks,
  selectedAbsencesForDate,
  xmlDayForDate,
} from '../../src/modules/guardies/domain/day.js';

test('completa les set sessions i insereix el pati després de tercera', () => {
  assert.deepEqual(
    completeGuardDutyHours(['8:00', '8:55', '9:50', '11:15', '12:10', '13:05']),
    ['8:00', '8:55', '9:50', 'PATI', '11:15', '12:10', '13:05', '14:00'],
  );
  assert.deepEqual(completeGuardDutyHours(['08:00', '09:00']), ['08:00', '09:00', 'PATI']);
});

test('converteix dates locals a dies XML sense desplaçaments UTC', () => {
  assert.equal(xmlDayForDate('2026-09-07'), '1');
  assert.equal(xmlDayForDate('2026-09-13'), '7');
  assert.equal(dateForXmlDayInSameWeek('2026-09-09', '1'), '2026-09-07');
});
test('selecciona absències exclusivament del dia actiu', () => {
  const absences = new Map([
    ['a', { dia: '1', hora: '08:00', placa: 'P1' }],
    ['b', { dia: '2', hora: '08:00', placa: 'P2' }],
  ]);
  assert.deepEqual(selectedAbsencesForDate(absences, '2026-09-07'), [absences.get('a')]);
  assert.equal(isTeacherAbsentAtSlot(absences, '1', '08:00', 'P1'), true);
  assert.equal(isTeacherAbsentAtSlot(absences, '1', '09:00', 'P1'), false);
});

test('agrupa un bloc compartit i exigeix que tots els grups siguin fora', () => {
  const base = { placa: 'P1', dia: '1', hora: '08:00', teClasse: true, materia: 'M', aula: 'A' };
  const sessions = [
    { ...base, grup: '1A', grupVisible: '1ESO-A' },
    { ...base, grup: '1B', grupVisible: '1ESO-B' },
  ];
  assert.equal(groupTeachingBlocks(sessions).length, 1);
  const selected = new Map([
    ['1A', new Set(['08:00|P1'])],
    ['1B', new Set(['08:00|P1'])],
  ]);
  assert.equal(releasedTeachingBlocks({ sessions, date: '2026-09-07', groupsOut: new Set(['1A']), enabledTeachersByGroup: selected }).length, 0);
  assert.equal(releasedTeachingBlocks({ sessions, date: '2026-09-07', groupsOut: new Set(['1A', '1B']), enabledTeachersByGroup: selected }).length, 1);
});

test('un professor de grup flexible només queda lliure quan surten els dos grups', () => {
  const lesson = (placa, grup) => ({
    placa,
    grup,
    grupVisible: grup === '1A' ? '1ESO-A' : '1ESO-B',
    dia: '1',
    hora: '08:00',
    teClasse: true,
    materia: 'MAT',
    aula: 'A',
  });
  const sessions = [
    lesson('PEP', '1A'),
    lesson('JUAN', '1A'),
    lesson('ANITA', '1B'),
    lesson('JUANITA', '1B'),
    lesson('SUTANITA', '1A'),
    lesson('SUTANITA', '1B'),
  ];
  const selections = new Map([
    ['1A', new Set(['08:00|PEP', '08:00|JUAN', '08:00|SUTANITA'])],
    ['1B', new Set(['08:00|ANITA', '08:00|JUANITA', '08:00|SUTANITA'])],
  ]);

  const onlyA = releasedTeachingBlocks({
    sessions,
    date: '2026-09-07',
    groupsOut: new Set(['1A']),
    enabledTeachersByGroup: selections,
  }).map((block) => block.placa).sort();
  assert.deepEqual(onlyA, ['JUAN', 'PEP']);

  const bothGroups = releasedTeachingBlocks({
    sessions,
    date: '2026-09-07',
    groupsOut: new Set(['1A', '1B']),
    enabledTeachersByGroup: selections,
  }).map((block) => block.placa).sort();
  assert.deepEqual(bothGroups, ['ANITA', 'JUAN', 'JUANITA', 'PEP', 'SUTANITA']);
});

test('detecta el professor que queda dins la mateixa aula amb el mateix grup', () => {
  const sessions = [
    { placa: 'P1', dia: '1', hora: '8:00', grup: '1A', aula: 'A12', teClasse: true },
    { placa: 'P2', dia: '1', hora: '8:00', grup: '1A', aula: 'A12', teClasse: true },
  ];
  const absence = { id: 'P1|1|8:00', placa: 'P1', dia: '1', hora: '8:00' };
  const absences = new Map([[absence.id, absence]]);

  assert.equal(classroomPartnerForAbsence({ sessions, absence, absences }), 'P2');
});

test('no considera docència compartida els blocs flexibles ni dues absències', () => {
  const flexibleSessions = [
    { placa: 'P1', dia: '1', hora: '8:00', grup: '1A', aula: 'A12', teClasse: true },
    { placa: 'P1', dia: '1', hora: '8:00', grup: '1B', aula: 'A12', teClasse: true },
    { placa: 'P2', dia: '1', hora: '8:00', grup: '1A', aula: 'A12', teClasse: true },
  ];
  const absence = { id: 'P1|1|8:00', placa: 'P1', dia: '1', hora: '8:00' };
  assert.equal(classroomPartnerForAbsence({
    sessions: flexibleSessions,
    absence,
    absences: new Map([[absence.id, absence]]),
  }), '');

  const sharedSessions = flexibleSessions.filter((session) => session.grup === '1A');
  const secondAbsence = { id: 'P2|1|8:00', placa: 'P2', dia: '1', hora: '8:00' };
  assert.equal(classroomPartnerForAbsence({
    sessions: sharedSessions,
    absence,
    absences: new Map([[absence.id, absence], [secondAbsence.id, secondAbsence]]),
  }), '');
});

test('agrupa en una sola cobertura els dos professors absents del mateix grup i aula', () => {
  const sessions = [
    { placa: 'P1', dia: '1', hora: '8:55', grup: '1A', aula: 'A12', teClasse: true },
    { placa: 'P2', dia: '1', hora: '8:55', grup: '1A', aula: 'A12', teClasse: true },
  ];
  const absences = [
    { id: 'P1|1|8:55', placa: 'P1', dia: '1', hora: '8:55', grups: ['1A'], grupsVisibles: ['1ESO-A'] },
    { id: 'P2|1|8:55', placa: 'P2', dia: '1', hora: '8:55', grups: ['1A'], grupsVisibles: ['1ESO-A'] },
  ];

  const result = mergeSharedClassroomAbsences({ sessions, absences });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].absenceIds, ['P1|1|8:55', 'P2|1|8:55']);
  assert.deepEqual(result[0].absentTeacherIds, ['P1', 'P2']);
  assert.deepEqual(result[0].grupsVisibles, ['1ESO-A']);
});
