import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COVERAGE_SOURCE,
  DAY_STATUS,
  absenceId,
  canTransitionDay,
  createAbsence,
  createCoverage,
  createGuardiesDay,
  isReleasedTeachingBlock,
  slotId,
} from '../../src/modules/guardies/domain/model.js';

test('crea identificadors deterministes de franja i absència', () => {
  const slot = slotId(1, '08:00');
  const input = { date: '2026-09-07', teacherId: 'ADEL', slotId: slot, scheduleBlockId: 'bloc-1' };
  assert.equal(slot, '1_08%3A00');
  assert.equal(absenceId(input), absenceId(input));
});

test('normalitza una jornada nova com a esborrany', () => {
  assert.deepEqual(createGuardiesDay({
    courseId: '2026-27',
    date: '2026-09-07',
    scheduleRevisionId: 'rev-1',
  }), {
    schemaVersion: 1,
    courseId: '2026-27',
    date: '2026-09-07',
    scheduleRevisionId: 'rev-1',
    status: DAY_STATUS.DRAFT,
    revision: 0,
    notes: '',
  });
});

test("deduplica les sessions d'una absència", () => {
  const absence = createAbsence({
    date: '2026-09-07',
    teacherId: 'ADEL',
    slotId: slotId(1, '08:00'),
    scheduleBlockId: 'bloc-1',
    sessionIds: ['s2', 's1', 's2'],
  });
  assert.deepEqual(absence.sessionIds, ['s1', 's2']);
});

test('impedeix que el professor absent es cobreixi a si mateix', () => {
  const absence = createAbsence({
    date: '2026-09-07',
    teacherId: 'ADEL',
    slotId: slotId(1, '08:00'),
    scheduleBlockId: 'bloc-1',
  });
  assert.throws(
    () => createCoverage({ teacherId: 'ADEL', source: COVERAGE_SOURCE.DUTY }, absence),
    /no es pot cobrir a si mateix/,
  );
});

test('un bloc compartit només queda alliberat si ho estan tots els grups', () => {
  const block = { teacherId: 'ADEL', slotId: '1_08%3A00', groupIds: ['1A', '1B'] };
  const selected = new Map([
    ['1A', new Set(['1_08%3A00|ADEL'])],
    ['1B', new Set(['1_08%3A00|ADEL'])],
  ]);
  assert.equal(isReleasedTeachingBlock(block, new Set(['1A']), selected), false);
  assert.equal(isReleasedTeachingBlock(block, new Set(['1A', '1B']), selected), true);
});

test('restringeix les transicions de jornada', () => {
  assert.equal(canTransitionDay(DAY_STATUS.DRAFT, DAY_STATUS.PUBLISHED), true);
  assert.equal(canTransitionDay(DAY_STATUS.DRAFT, DAY_STATUS.CLOSED), false);
  assert.equal(canTransitionDay(DAY_STATUS.CLOSED, DAY_STATUS.DRAFT), false);
});
