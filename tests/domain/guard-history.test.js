import assert from 'node:assert/strict';
import test from 'node:test';
import { displayHistoryGroups, guardHistoryFromClosedDays, guardHistoryGroups, guardSlotFromAssignment, slotHistoryEntries } from '../../src/modules/guardies/domain/guard-history.js';

test('desa només els grups visibles i recorre als cursos si no n\'hi ha', () => {
  assert.deepEqual(guardHistoryGroups({
    grupsVisibles: ['3ESO-E'], cursosVisibles: ['3ESO'], grups: ['662663'], cursos: ['94'],
  }), ['3ESO-E']);
  assert.deepEqual(guardHistoryGroups({ grupsVisibles: [], cursosVisibles: ['3ESO'], grups: ['662663'] }), ['3ESO']);
  assert.deepEqual(guardHistoryGroups({}), []);
});

test('neteja els grups ja desats sense perdre els grups reals', () => {
  assert.deepEqual(displayHistoryGroups(['3ESO-B', '3ESO-D', '3ESO', '662663', '662665', '94']), ['3ESO-B', '3ESO-D']);
  assert.deepEqual(displayHistoryGroups(['3ESO', '662663']), ['3ESO']);
  assert.deepEqual(displayHistoryGroups(['1BAT-A', '1BAT-A']), ['1BAT-A']);
  assert.deepEqual(displayHistoryGroups(['94']), []);
  assert.deepEqual(displayHistoryGroups(undefined), []);
});

test('reconstrueix l\'historial per franja, sense cancel·lades ni alliberats', () => {
  const days = [
    ['2026-09-07', {
      status: 'closed',
      cancelledAssignments: ['P|1|9:50|c'],
      assignments: {
        'P|1|8:00|a': { teacherId: '2', source: 'guard' },
        'P|1|8:55|b': { teacherId: '2', source: 'guard' },
        'P|1|8:55|e': { teacherId: '2', source: 'guard' },
        'P|1|9:50|c': { teacherId: '2', source: 'guard' },
        'P|1|8:00|d': { teacherId: '3', source: 'released' },
      },
    }],
    ['2026-09-08', { status: 'published', assignments: { 'P|2|8:00|z': { teacherId: '2', source: 'guard' } } }],
  ];
  assert.deepEqual(guardHistoryFromClosedDays(days, {
    'P|1|8:00|a': { groups: ['1ESO-A'] }, 'P|1|8:55|b': { groups: ['2ESO-B'] }, 'P|1|8:55|e': { groups: ['2ESO-C'] },
  }), { 2: { '2026-09-07': { '1|8:00': ['1ESO-A'], '1|8:55': ['2ESO-B', '2ESO-C'] } } });
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
