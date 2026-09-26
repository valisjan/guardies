import test from 'node:test';
import assert from 'node:assert/strict';
import { publicProjectionForDay, publicProjectionsEqual } from '../../src/modules/guardies/domain/publication.js';

test('Firestore map ordering and server timestamps do not trigger a public rewrite', () => {
  const projection = { hours: [{ label: '1a', rows: [{ absent: 'Anna', assigned: 'Joan', comment: 'Feina' }] }], groupsOut: [] };
  const day = { status: 'published', revision: 3, clientUpdatedAt: '2026-09-07T08:00:00Z' };
  const original = publicProjectionForDay(projection, day, 'test', '2026-09-07');
  const fromServer = { ...original, updatedAt: 'server-time', hours: [{ rows: [{ comment: 'Feina', assigned: 'Joan', absent: 'Anna' }], label: '1a' }] };
  assert.equal(publicProjectionsEqual(original, fromServer), true);
  assert.equal(publicProjectionsEqual(original, { ...fromServer, revision: 4 }), false);
  assert.equal(publicProjectionsEqual(original, { ...fromServer, hours: [] }), false);
  assert.equal(publicProjectionForDay(projection, { ...day, status: 'draft' }, 'test', '2026-09-07'), null);
});
