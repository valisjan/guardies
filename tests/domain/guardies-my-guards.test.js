import test from 'node:test';
import assert from 'node:assert/strict';
import {
  myPublishedGuards,
  teacherHistoryEntries,
  viewerTeacher,
  weeklyTimetable,
} from '../../src/modules/guardies/domain/my-guards.js';

test('viewerTeacher troba el professor pel nom del compte, sense el codi curt', () => {
  const options = [
    { placa: '1', name: 'Adell Domènech, Marina', label: 'Adell Domènech, Marina · ADEL' },
    { placa: '2', name: '', label: 'Fuentes Serra, Gabriel · FUEN' },
  ];
  assert.equal(viewerTeacher(options, 'Marina Adell')?.placa, '1');
  assert.equal(viewerTeacher(options, 'Gabriel Fuentes Serra')?.placa, '2');
  assert.equal(viewerTeacher(options, 'Clara Sanz'), null);
});

test('myPublishedGuards recull les cobertures i el pati de qui ha entrat', () => {
  const days = [{
    date: '2026-11-02',
    hours: [
      { label: '1a hora · 8:00', rows: [
        { absent: 'Sanz Vidal, Clara', assigned: 'Adell Domènech, Marina', group: '1ESO-A', subject: 'MAT', room: 'Aula 14' },
        { absent: 'Pere Blanes', assigned: 'Fuentes Serra, Gabriel', group: '2ESO-B' },
        { absent: 'Joan', assigned: 'Adell Domènech, Marina', group: '3ESO-A', cancelled: true },
      ] },
      { kind: 'patio', label: 'Pati · 10:45–11:15', patio: { zones: [{ name: 'Pista', teacher: 'Adell Domènech, Marina', absent: false }] } },
    ],
  }];
  assert.deepEqual(myPublishedGuards(days, 'Marina Adell'), [
    { date: '2026-11-02', hour: '1a hora · 8:00', kind: 'guard', absent: 'Sanz Vidal, Clara', group: '1ESO-A', subject: 'MAT', room: 'Aula 14', comment: '' },
    { date: '2026-11-02', hour: 'Pati · 10:45–11:15', kind: 'patio', zone: 'Pista', absent: false },
  ]);
});

test('teacherHistoryEntries fusiona els àlies i ordena de la més recent a la més antiga', () => {
  const history = {
    ADEL: { '2026-10-01': { '1|8:00': ['1ESO-A'] } },
    1: { '2026-10-20': { '2|9:50': ['2ESO-B'] }, '2026-10-01': { '1|8:00': ['1ESO-C'] } },
    FUEN: { '2026-10-21': { '3|8:00': ['3ESO-A'] } },
    adel: { '2026-09-15': ['4ESO-A'] },
  };
  assert.deepEqual(teacherHistoryEntries(history, ['1', 'ADEL']), [
    { date: '2026-10-20', slot: '2|9:50', groups: ['2ESO-B'] },
    { date: '2026-10-01', slot: '1|8:00', groups: ['1ESO-A', '1ESO-C'] },
    { date: '2026-09-15', slot: '', groups: ['4ESO-A'] },
  ]);
});

test('weeklyTimetable posa el pati a les 10:45 i marca classes, guàrdies i pati', () => {
  const sessions = [
    { placa: '1', dia: '1', hora: '8:00', teClasse: true, materiaCurta: 'MAT' },
    { placa: '1', dia: '1', hora: '9:50', activitat: 'G' },
    { placa: '1', dia: '1', hora: 'PATI', activitat: 'GP' },
    { placa: '1', dia: '2', hora: '11:15', teClasse: true },
    { placa: '2', dia: '3', hora: '12:10', teClasse: true },
  ];
  const rows = weeklyTimetable(sessions, '1', (session) => session.activitat === 'G');
  assert.deepEqual(rows.map((row) => row.label), ['8:00', '9:50', '10:45', '11:15']);
  assert.deepEqual([...rows[1].cells[0].kinds], ['guard']);
  assert.deepEqual([...rows[2].cells[0].kinds], ['patio']);
  assert.deepEqual([...rows[0].cells[0].kinds], ['class']);
  assert.equal(rows[3].cells[1].items.length, 1);
});
