import assert from 'node:assert/strict';
import test from 'node:test';
import { displayHistoryGroups, guardHistoryGroups } from '../../src/modules/guardies/domain/guard-history.js';

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
