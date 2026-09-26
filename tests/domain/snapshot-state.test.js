import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotState } from '../../src/utils/snapshotState.js';

const snapshot = (data, fromCache, hasPendingWrites = false) => ({
  exists: () => data !== null, data: () => data, metadata: { fromCache, hasPendingWrites },
});

test('cache -> identical server data confirms freshness without another content update', () => {
  const observe = createSnapshotState();
  assert.equal(observe(snapshot({ revision: 1 }, true)).metadataOnly, false);
  assert.deepEqual(observe(snapshot({ revision: 1 }, false)), {
    fromCache: false, hasPendingWrites: false, metadataOnly: true, reads: 1,
  });
  assert.equal(observe(snapshot({ revision: 1 }, false)).reads, 0);
  assert.equal(observe(snapshot({ revision: 2 }, false)).metadataOnly, false);
});

test('pending local writes are not counted as server reads; deletion remains a data change', () => {
  const observe = createSnapshotState();
  observe(snapshot({ revision: 1 }, false));
  assert.equal(observe(snapshot({ revision: 2 }, true, true)).reads, 0);
  assert.equal(observe(snapshot({ revision: 2 }, false)).reads, 0);
  assert.equal(observe(snapshot(null, false)).metadataOnly, false);
  assert.equal(observe(snapshot(null, false)).reads, 0);
});
