import { expect, test } from '@playwright/test';

// Exercise the production service path with a controllable SDK boundary.
// This covers metadata-only events and failed transactions without writing to
// the school's database. It is not a Firestore emulator/rules validation.
const sdk = `
const f = window.__firestoreTest = { docs: new Map(), listeners: new Map(), commits: [], failPublic: false, reads: [] };
const snapshot = (path, data, metadata = { fromCache: false, hasPendingWrites: false }) => ({
  id: path.split('/').pop(), exists: () => data != null, data: () => data, metadata,
});
export const doc = (_, ...parts) => ({ path: parts.join('/') });
export const collection = doc;
export const serverTimestamp = () => 'server-time';
export const getDoc = async (ref) => { f.reads.push(ref.path); return snapshot(ref.path, f.docs.get(ref.path)); };
export const getDocs = async () => ({ docs: [] });
export const enableNetwork = async () => {};
export const query = (ref) => ref;
export const where = () => ({});
export const setDoc = async (ref, value) => f.docs.set(ref.path, value);
export const deleteDoc = async (ref) => f.docs.delete(ref.path);
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, async commit() {} });
export function onSnapshot(ref, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const entry = { options, callback };
  if (!f.listeners.has(ref.path)) f.listeners.set(ref.path, new Set());
  f.listeners.get(ref.path).add(entry);
  return () => f.listeners.get(ref.path).delete(entry);
}
f.emit = async (path, data, metadata = { fromCache: false, hasPendingWrites: false }, changed = true) => {
  const value = Array.isArray(data) ? {
    docs: data.map(([id, item]) => snapshot(path + '/' + id, item, metadata)), metadata,
    docChanges: () => changed ? data.map(([id, item]) => ({ doc: snapshot(path + '/' + id, item, metadata), type: 'modified' })) : [],
  } : snapshot(path, data, metadata);
  for (const entry of f.listeners.get(path) || []) entry.callback(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
};
export async function runTransaction(_, callback) {
  const operations = [];
  let writing = false;
  const tx = {
    async get(ref) { if (writing) throw Error('read after write'); return snapshot(ref.path, f.docs.get(ref.path)); },
    set(ref, value) { writing = true; operations.push(['set', ref.path, value]); },
    update(ref, value) { writing = true; operations.push(['set', ref.path, { ...f.docs.get(ref.path), ...value }]); },
    delete(ref) { writing = true; operations.push(['delete', ref.path]); },
  };
  const result = await callback(tx);
  if (f.failPublic && operations.some(([, path]) => path.includes('/guardiesPublicDays/'))) throw Error('public commit failed');
  for (const [action, path, value] of operations) {
    if (action === 'delete') f.docs.delete(path); else f.docs.set(path, value);
  }
  f.commits.push(operations);
  return result;
}
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/firebase-test', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.route('**/node_modules/.vite/deps/firebase_firestore.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: sdk }));
  await page.route('**/src/firebase*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const db = {}; export const auth = {}; export const isIOSWebKit = false; export const authPersistenceReady = Promise.resolve();' }));
  await page.route('**/src/services/e2e*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const E2E_AUTH_BYPASS = false; export const E2E_CURS_ID = "test"; export const getE2ECollection = () => [];' }));
  await page.goto('/firebase-test');
});

test('identical server confirmation restores metadata without re-emitting configuration', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { subscribeGuardiesData, subscribeDirectoryVersion } = await import('/src/services/guardiesStorage.js');
    const f = window.__firestoreTest;
    let changes = 0, metadata, invalidations = 0;
    localStorage.setItem('quota_guardies_teacher_dir:test', JSON.stringify({ version: 1, data: [], savedAt: Date.now() }));
    const stop = subscribeGuardiesData('test', () => changes++, () => {}, { onMetadata: (value) => { metadata = value; } });
    const stopVersion = subscribeDirectoryVersion('test', () => invalidations++);
    const cache = { fromCache: true, hasPendingWrites: false };
    const root = 'cursos/test/guardies';
    const docs = [['duties', { text: 'unchanged', name: 'GPU001.TXT' }], ['directoriVersion', { version: 2 }]];
    await f.emit(root, docs, cache);
    await f.emit('cursos/test/config/guardies-exclusions', null, cache);
    await f.emit('cursos/test/config/guardies-observations', null, cache);
    await f.emit(root + '/directoriVersion', { version: 2 }, cache);
    const before = changes;
    await f.emit(root, docs, undefined, false);
    await f.emit('cursos/test/config/guardies-exclusions', null);
    await f.emit('cursos/test/config/guardies-observations', null);
    await f.emit(root + '/directoriVersion', { version: 2 });
    const options = [...f.listeners.values()].flatMap((entries) => [...entries].map((entry) => entry.options.includeMetadataChanges));
    stop(); stopVersion();
    return { before, changes, metadata, invalidations, options, active: [...f.listeners.values()].reduce((n, set) => n + set.size, 0) };
  });
  expect(result).toEqual({ before: 1, changes: 1, metadata: { fromCache: false, hasPendingWrites: false }, invalidations: 1, options: [true, true, true, true], active: 0 });
});

test('public-day cache confirmation is delivered as metadata; later deletion still changes data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { subscribeGuardiesPublicView } = await import('/src/services/guardiesStorage.js');
    const f = window.__firestoreTest;
    const events = [];
    const stop = subscribeGuardiesPublicView('test', '2026-09-07', (day, metadata) => events.push({ day, ...metadata }));
    const path = 'cursos/test/guardiesPublicDays/2026-09-07';
    const day = { status: 'published', revision: 3 };
    await f.emit(path, day, { fromCache: true, hasPendingWrites: false });
    await f.emit(path, day);
    await f.emit(path, null);
    stop();
    return events;
  });
  expect(result.map((event) => [event.metadataOnly, event.fromCache, event.day?.revision || null])).toEqual([[false, true, 3], [true, false, 3], [false, false, null]]);
});

test('private/public commit together, failure commits neither, and obsolete repair cannot republish', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { saveGuardiesDay, transitionGuardiesDay } = await import('/src/services/guardiesStorage.js');
    const { savePublicGuardiesDay } = await import('/src/services/pantallesStorage.js');
    const f = window.__firestoreTest;
    const root = 'cursos/test/';
    const date = '2026-09-07';
    const privatePath = root + 'guardiesDays/' + date;
    const publicPath = root + 'guardiesPublicDays/' + date;
    const projection = { hours: [{ label: '1a hora', rows: [] }], groupsOut: [] };
    const saved = await saveGuardiesDay('test', date, { status: 'published' }, 0, { publicProjection: projection });
    const publicRevision = f.docs.get(publicPath).revision;
    f.failPublic = true;
    let failed = false;
    try { await saveGuardiesDay('test', date, { status: 'published', comments: { note: 'new' } }, 1, { publicProjection: projection }); } catch { failed = true; }
    const failedPrivateRevision = f.docs.get(privatePath).revision;
    f.failPublic = false;
    let staleTransition;
    try { await transitionGuardiesDay('test', date, 'close', { publicProjection: projection, expectedRevision: 0 }); }
    catch (error) { staleTransition = error.code; }
    const staleProjection = { ...f.docs.get(publicPath) };
    await transitionGuardiesDay('test', date, 'unpublish', { publicProjection: projection });
    const obsoleteRepair = await savePublicGuardiesDay('test', date, staleProjection);
    await transitionGuardiesDay('test', date, 'publish', { publicProjection: projection });
    const beforeCheck = f.commits.length;
    const matchingRepair = await savePublicGuardiesDay('test', date, f.docs.get(publicPath));
    return { savedRevision: saved.revision, publicRevision, failed, failedPrivateRevision, staleTransition, obsoleteRepair,
      finalPrivate: f.docs.get(privatePath).revision, finalPublic: f.docs.get(publicPath).revision,
      matchingRepair, matchingWrites: f.commits.length - beforeCheck,
      commits: f.commits.map((ops) => ops.map(([, path]) => path)) };
  });
  expect(result).toMatchObject({ savedRevision: 1, publicRevision: 1, failed: true, failedPrivateRevision: 1,
    staleTransition: 'guardies/conflict', obsoleteRepair: false, finalPrivate: 3, finalPublic: 3, matchingRepair: true, matchingWrites: 0 });
  expect(result.commits.filter((paths) => paths.length).every((paths) => paths.some((p) => p.includes('/guardiesDays/')) && paths.some((p) => p.includes('/guardiesPublicDays/')))).toBe(true);
});

test('teacher statistics read only the schedule once and listen only to the stats document', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { loadGuardiesTeacherSchedule, subscribeGuardiesStats } = await import('/src/services/guardiesStorage.js');
    const f = window.__firestoreTest;
    const root = 'cursos/test/guardies';
    f.docs.set(root + '/reference', { text: '<ref/>', name: 'ref.xml' });
    f.docs.set(root + '/untis', { text: 'untis', name: 'untis.txt' });
    f.docs.set(root + '/duties', { text: 'duties', name: 'GPU001.TXT' });
    f.docs.set('cursos/test/config/guardies-exclusions', { excludedTeacherIds: ['AGR1'] });
    const schedule = await loadGuardiesTeacherSchedule('test');
    const reads = [...f.reads].sort();

    const events = [];
    const stop = subscribeGuardiesStats('test', (stats) => events.push(stats.counts));
    const listened = [...f.listeners.keys()];
    const stats = { counts: { 2: { guard: 1 } } };
    await f.emit(root + '/stats', stats, { fromCache: true, hasPendingWrites: false });
    await f.emit(root + '/stats', stats);
    await f.emit(root + '/stats', { counts: { 2: { guard: 2 } } });
    stop();
    const active = [...f.listeners.values()].reduce((n, set) => n + set.size, 0);
    return { reads, files: Object.values(schedule.files).map((file) => file?.name), excluded: schedule.excludedTeacherIds, listened, events, active };
  });
  expect(result.reads).toEqual([
    'cursos/test/config/guardies-exclusions',
    'cursos/test/guardies/duties',
    'cursos/test/guardies/reference',
    'cursos/test/guardies/untis',
  ]);
  expect(result.files).toEqual(['ref.xml', 'untis.txt', 'GPU001.TXT']);
  expect(result.excluded).toEqual(['AGR1']);
  expect(result.listened).toEqual(['cursos/test/guardies/stats']);
  expect(result.events).toEqual([{ 2: { guard: 1 } }, { 2: { guard: 2 } }]);
  expect(result.active).toBe(0);
});

test.describe('iOS polling', () => {
  // Same service code with isIOSWebKit enabled and a controllable REST client.
  const rest = `
const r = window.__restTest = { calls: [], pending: [], hold: false, docs: new Map() };
const snap = (path, data) => ({ id: path.split('/').pop(), exists: () => data != null, data: () => data });
export async function getRestDocument(path, { signal } = {}) {
  r.calls.push(path);
  if (!r.hold) return snap(path, r.docs.get(path));
  return new Promise((resolve, reject) => {
    const entry = { path, aborted: false, resolve: () => resolve(snap(path, r.docs.get(path))) };
    r.pending.push(entry);
    signal?.addEventListener('abort', () => {
      entry.aborted = true;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'aborted' }));
    });
  });
}
export async function getRestCollection() { return { docs: [] }; }
export function abortedError(cause) { return Object.assign(new Error('aborted', { cause }), { name: 'AbortError', code: 'aborted' }); }
`;

  test.beforeEach(async ({ page }) => {
    await page.route('**/src/firebase*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const db = {}; export const auth = {}; export const isIOSWebKit = true; export const authPersistenceReady = Promise.resolve();' }));
    await page.route('**/src/services/firestoreRest*', (route) => route.fulfill({ contentType: 'application/javascript', body: rest }));
    await page.evaluate(() => {
      window.__hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
      window.__setHidden = (value) => { window.__hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    });
  });

  test('unsubscribing aborts the in-flight request without reporting an error', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { subscribeGuardiesStats } = await import('/src/services/guardiesStorage.js');
      const r = window.__restTest;
      r.hold = true;
      const changes = [];
      const errors = [];
      const stop = subscribeGuardiesStats('test', (stats) => changes.push(stats), (error) => errors.push(error.message));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = r.pending.length;
      stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { started, aborted: r.pending.map((entry) => entry.aborted), changes: changes.length, errors };
    });
    expect(result).toEqual({ started: 1, aborted: [true], changes: 0, errors: [] });
  });

  test('a poll missed while hidden runs on return; a quick return does not add reads', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { subscribeGuardiesStats } = await import('/src/services/guardiesStorage.js');
      const r = window.__restTest;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const stop = subscribeGuardiesStats('test', () => {}, () => {}, { iosPollInterval: 600 });
      await wait(50);
      const afterFirst = r.calls.length;

      // Quick hide/show: nothing was due, so no extra request.
      window.__setHidden(true);
      await wait(100);
      window.__setHidden(false);
      await wait(50);
      const afterQuickReturn = r.calls.length;

      // Hidden across a due poll: skipped while hidden, run right after returning.
      window.__setHidden(true);
      await wait(900);
      const whileHidden = r.calls.length;
      window.__setHidden(false);
      await wait(50);
      const afterReturn = r.calls.length;
      stop();
      return { afterFirst, afterQuickReturn, whileHidden, afterReturn };
    });
    expect(result).toEqual({ afterFirst: 1, afterQuickReturn: 1, whileHidden: 1, afterReturn: 2 });
  });
});

test('REST reads report cancellation as aborted, not as a connection failure', async ({ page }) => {
  await page.route('**/src/firebase*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const auth = { currentUser: { getIdToken: async () => "token" } }; export const db = {}; export const isIOSWebKit = true; export const authPersistenceReady = Promise.resolve();',
  }));
  const result = await page.evaluate(async () => {
    const seen = [];
    window.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      seen.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const { getRestDocument } = await import('/src/services/firestoreRest.js');
    const controller = new AbortController();
    const pending = getRestDocument('cursos/test/guardies/stats', { signal: controller.signal }).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const aborted = await pending;

    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const offline = await getRestDocument('cursos/test/guardies/stats').catch((error) => error);
    return { abortedCode: aborted.code, fetchAborted: seen[0].aborted, offlineCode: offline.code };
  });
  expect(result).toEqual({ abortedCode: 'aborted', fetchAborted: true, offlineCode: 'unavailable' });
});
