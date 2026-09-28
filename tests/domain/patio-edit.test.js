import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPatioZoneOverride, mergePatioConfiguration } from '../../src/modules/guardies/domain/patio-edit.js';

const base = {
  startYear: 2026,
  zones: [{ id: 'pista', name: 'Pista' }, { id: 'porxada', name: 'Porxada' }],
  weekdayTeachers: { 1: [{ teacherId: 'FUEN', startZoneId: 'pista' }] },
  customHolidays: [],
};

test('a pending settings save preserves a daily override added after it began', () => {
  const desired = { ...base, customHolidays: [{ date: '2026-09-21', label: 'Festa del centre' }] };
  const latest = applyPatioZoneOverride(base, {
    day: '1', date: '2026-09-14', teacherId: 'FUEN', zoneId: 'porxada', baseZoneId: 'pista',
  });
  const merged = mergePatioConfiguration(base, desired, latest);
  assert.equal(merged.weekdayTeachers['1'][0].zoneOverrides['2026-09-14'], 'porxada');
  assert.equal(merged.customHolidays[0].label, 'Festa del centre');
});

test('independent administrators can edit different holidays and weekdays', () => {
  const first = mergePatioConfiguration(base, {
    ...base, customHolidays: [{ date: '2026-09-21', label: 'Festa del centre' }],
  }, base);
  const second = mergePatioConfiguration(base, {
    ...base, weekdayTeachers: { ...base.weekdayTeachers,
      2: [{ teacherId: 'SANZ', startZoneId: 'porxada' }] },
    customHolidays: [{ date: '2026-10-05', label: 'Festa local' }],
  }, first);
  assert.deepEqual(second.customHolidays.map((item) => item.date), ['2026-09-21', '2026-10-05']);
  assert.equal(second.weekdayTeachers['2'][0].teacherId, 'SANZ');
});

test('conflicting edits to the same zone are rejected instead of overwritten', () => {
  const first = mergePatioConfiguration(base, { ...base,
    zones: [{ id: 'pista', name: 'Pista coberta' }, base.zones[1]] }, base);
  assert.throws(() => mergePatioConfiguration(base, { ...base,
    zones: [{ id: 'pista', name: 'Pista gran' }, base.zones[1]] }, first),
  { code: 'guardies/conflict' });
});

test('restoring a rotating base zone removes only that date override', () => {
  const changed = applyPatioZoneOverride(base, {
    day: '1', date: '2026-09-14', teacherId: 'FUEN', zoneId: 'porxada', baseZoneId: 'pista',
  });
  changed.weekdayTeachers['1'][0].zoneOverrides['2026-09-21'] = 'porxada';
  const restored = applyPatioZoneOverride(changed, {
    day: '1', date: '2026-09-14', teacherId: 'FUEN', zoneId: 'pista', baseZoneId: 'pista',
  });
  assert.equal(restored.weekdayTeachers['1'][0].zoneOverrides['2026-09-14'], undefined);
  assert.equal(restored.weekdayTeachers['1'][0].zoneOverrides['2026-09-21'], 'porxada');
});
