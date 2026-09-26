import assert from 'node:assert/strict';
import test from 'node:test';
import { guardHistoryGroups, guardSlotFromAssignment, slotHistoryEntries } from '../../src/modules/guardies/domain/guard-history.js';

test('desa només els grups visibles i recorre als cursos si no n\'hi ha', () => {
  assert.deepEqual(guardHistoryGroups({
    grupsVisibles: ['3ESO-E'], cursosVisibles: ['3ESO'], grups: ['662663'], cursos: ['94'],
  }), ['3ESO-E']);
  assert.deepEqual(guardHistoryGroups({ grupsVisibles: [], cursosVisibles: ['3ESO'], grups: ['662663'] }), ['3ESO']);
  assert.deepEqual(guardHistoryGroups({}), []);
});

test('agafa la franja de l\'assignació o, si no n\'hi ha, de la clau de l\'absència', () => {
  assert.equal(guardSlotFromAssignment('P|3|10:20|x'), '3|10:20');
  assert.equal(guardSlotFromAssignment('x', { day: '2', hour: '9:50' }), '2|9:50');
  assert.equal(guardSlotFromAssignment('x', { slot: '4|8:00' }), '4|8:00');
  assert.equal(guardSlotFromAssignment('sense-franja'), '');
});

test('llista només les guàrdies d\'una franja, de la més recent a la més antiga, ignorant el format v1', () => {
  const dates = {
    '2026-09-04': ['7ESO-X'],
    '2026-09-11': { '1|8:00': ['1ESO-A'], '2|8:00': ['9ESO-Z'] },
    '2026-09-18': { '1|8:00': ['2ESO-B', '3ESO-B'] },
  };
  assert.deepEqual(slotHistoryEntries(dates, '1|8:00'), [
    { date: '2026-09-18', groups: ['2ESO-B', '3ESO-B'] },
    { date: '2026-09-11', groups: ['1ESO-A'] },
  ]);
  assert.deepEqual(slotHistoryEntries(dates, '5|8:00'), []);
  assert.deepEqual(slotHistoryEntries(undefined, '1|8:00'), []);
});
