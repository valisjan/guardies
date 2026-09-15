import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardCountDelta,
  guardCountForSlot,
  normalizeGuardCount,
  normalizeCountedAssignment,
  sortCoverageCandidates,
  teachingDatesBetween,
  updateGuardCounts,
} from '../../src/modules/guardies/domain/workflow.js';

test('genera només dies lectius dins un interval', () => {
  assert.deepEqual(teachingDatesBetween('2026-09-04', '2026-09-08'), [
    '2026-09-04', '2026-09-07', '2026-09-08',
  ]);
});

test('ordena alliberats pel total i professorat de G per la franja setmanal', () => {
  const candidates = [
    { teacherId: 'conv', convivencia: true },
    { teacherId: 'g2' },
    { teacherId: 'rel', released: true },
    { teacherId: 'g1' },
  ];
  const counts = new Map([
    ['g1', { guard: 8, guardSlots: { '1|8:00': 8 } }],
    ['g2', { guard: 12, guardSlots: { '1|8:00': 2, '2|8:00': 10 } }],
    ['rel', { released: 20 }],
  ]);
  assert.deepEqual(
    sortCoverageCandidates(candidates, counts, undefined, { day: '1', hour: '8:00' }).map((item) => item.teacherId),
    ['rel', 'g2', 'g1', 'conv'],
  );
});

test('calcula el delta en reobrir i tornar a tancar una jornada', () => {
  assert.deepEqual(Object.fromEntries(guardCountDelta(['A', 'B'], ['B', 'C', 'C'])), { A: -1, C: 2 });
});

test('conserva separats els recomptes com a alliberat i com a guàrdia', () => {
  assert.deepEqual(normalizeGuardCount({ total: 5, released: 2, guard: 3 }), {
    total: 5,
    released: 2,
    guard: 3,
    other: 0,
    guardLegacy: 3,
    guardSlots: {},
  });
  assert.deepEqual(normalizeGuardCount(4), {
    total: 4,
    released: 0,
    guard: 0,
    other: 4,
    guardLegacy: 0,
    guardSlots: {},
  });

  const closed = updateGuardCounts({}, [], [
    { teacherId: 'A', source: 'released' },
    { teacherId: 'A', source: 'guard', day: '1', hour: '8:00' },
  ]);
  assert.deepEqual(closed.A, {
    total: 2, released: 1, guard: 1, other: 0, guardLegacy: 0, guardSlots: { '1|8:00': 1 },
  });
  assert.equal(guardCountForSlot(closed.A, '1', '8:00'), 1);
  assert.equal(guardCountForSlot(closed.A, '2', '8:00'), 0);

  const corrected = updateGuardCounts(closed, [
    { teacherId: 'A', source: 'released' },
    { teacherId: 'A', source: 'guard', day: '1', hour: '8:00' },
  ], [
    { teacherId: 'A', source: 'guard', day: '1', hour: '8:00' },
  ]);
  assert.deepEqual(corrected.A, {
    total: 1, released: 0, guard: 1, other: 0, guardLegacy: 0, guardSlots: { '1|8:00': 1 },
  });
});

test('no compta el professor que ja queda dins l’aula', () => {
  assert.equal(normalizeCountedAssignment({ teacherId: 'P2', source: 'co-teacher' }), null);
  assert.deepEqual(updateGuardCounts({}, [], [
    { teacherId: 'P2', source: 'co-teacher' },
  ]), {});
});
