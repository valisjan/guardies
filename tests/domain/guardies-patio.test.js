import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nonTeachingReason,
  normalizePatioConfig,
  patioAssignmentsForDate,
  teachingOccurrenceIndex,
  weekDates,
} from '../../src/modules/guardies/domain/patio.js';

function config(overrides = {}) {
  return normalizePatioConfig({
    startYear: 2026,
    zones: [
      { id: 'a', name: 'Pista' },
      { id: 'b', name: 'Porxada' },
      { id: 'c', name: 'Jardí' },
    ],
    weekdayTeachers: {
      1: [{ teacherId: 'pep', startZoneId: 'a' }],
      2: [{ teacherId: 'aina', startZoneId: 'c' }],
    },
    ...overrides,
  }, { startYear: 2026 });
}

test('el calendari oficial marca festius i períodes de vacances', () => {
  const current = config();
  assert.equal(nonTeachingReason('2026-10-12', current)?.kind, 'official');
  assert.equal(nonTeachingReason('2026-12-28', current)?.label, 'Vacances de Nadal');
  assert.equal(nonTeachingReason('2027-03-29', current)?.label, 'Vacances de Pasqua');
  assert.equal(nonTeachingReason('2026-09-14', current), null);
});

test('un festiu no genera pati ni consumeix un pas de la rotació del seu dia', () => {
  const current = config();
  assert.deepEqual(patioAssignmentsForDate('2026-09-14', current).map((item) => item.zoneName), ['Pista']);
  assert.deepEqual(patioAssignmentsForDate('2026-10-05', current).map((item) => item.zoneName), ['Pista']);
  assert.deepEqual(patioAssignmentsForDate('2026-10-12', current), []);
  assert.deepEqual(patioAssignmentsForDate('2026-10-19', current).map((item) => item.zoneName), ['Porxada']);
  assert.equal(teachingOccurrenceIndex('2026-10-19', current), 4);
});

test('cada dia de la setmana conserva una rotació independent', () => {
  const current = config();
  assert.deepEqual(patioAssignmentsForDate('2026-09-15', current).map((item) => item.zoneName), ['Jardí']);
  assert.deepEqual(patioAssignmentsForDate('2026-09-22', current).map((item) => item.zoneName), ['Pista']);
  assert.deepEqual(patioAssignmentsForDate('2026-09-21', current).map((item) => item.zoneName), ['Porxada']);
});

test('un canvi de zona puntual només afecta la data indicada', () => {
  const current = config({
    weekdayTeachers: {
      1: [{ teacherId: 'pep', startZoneId: 'a', zoneOverrides: { '2026-09-14': 'c' } }],
    },
  });
  const changed = patioAssignmentsForDate('2026-09-14', current)[0];
  assert.equal(changed.zoneName, 'Jardí');
  assert.equal(changed.baseZoneName, 'Pista');
  assert.equal(changed.overridden, true);
  assert.equal(patioAssignmentsForDate('2026-09-21', current)[0].zoneName, 'Porxada');
});

test('els dies no lectius del centre s’afegeixen als oficials', () => {
  const current = config({
    customHolidays: [{ date: '2026-09-21', label: 'Festa del centre' }],
  });
  assert.equal(nonTeachingReason('2026-09-21', current)?.kind, 'centre');
  assert.deepEqual(patioAssignmentsForDate('2026-09-21', current), []);
  assert.deepEqual(patioAssignmentsForDate('2026-09-28', current).map((item) => item.zoneName), ['Porxada']);
});

test('la previsualització sempre retorna de dilluns a divendres', () => {
  assert.deepEqual(weekDates('2026-09-19'), [
    '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  ]);
});
