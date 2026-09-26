import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { E2E_AUTH_BYPASS, E2E_CURS_ID } from './e2e';
import { createSnapshotState } from '../utils/snapshotState.js';
import { publicProjectionForDay, publicProjectionsEqual } from '../modules/guardies/domain/publication.js';
import { trackReads } from '../utils/diagnostics.js';

export const DEFAULT_SCREEN_ID = 'sala-professorat';
const E2E_SCREEN_PREFIX = 'quota-e2e-pantalla:';
const E2E_GUARDIES_PREFIX = 'quota-e2e-guardies:';

export const DEFAULT_SCREEN_CONFIG = Object.freeze({
  schemaVersion: 1,
  name: 'Sala de professorat',
  active: true,
  courseId: '2026-2027',
  dateMode: 'today',
  selectedDate: '',
  theme: 'light',
  scale: 100,
  modules: ['guardies', 'pati', 'sortides'],
  views: [{
    id: 'guardies',
    name: 'Guàrdies del dia',
    duration: 20,
    modules: ['guardies', 'pati', 'sortides'],
    type: 'guardies',
    driveUrl: '',
    canvaUrl: '',
  }],
  forcedViewId: '',
  message: '',
});

const AVAILABLE_MODULES = ['guardies', 'pati', 'sortides'];
const VIEW_TYPES = ['guardies', 'drive', 'canva'];

function normalizeModules(modules) {
  return Array.from(new Set(Array.isArray(modules) ? modules : []))
    .filter((item) => AVAILABLE_MODULES.includes(item));
}

function normalizeViews(data = {}) {
  const legacyModules = normalizeModules(data.modules);
  const source = Array.isArray(data.views) && data.views.length
    ? data.views
    : [{
      id: 'guardies',
      name: 'Guàrdies del dia',
      duration: 20,
      modules: legacyModules.length ? legacyModules : DEFAULT_SCREEN_CONFIG.modules,
    }];
  const usedIds = new Set();
  return source.slice(0, 12).map((view, index) => {
    const fallbackId = `vista-${index + 1}`;
    let id = String(view?.id || fallbackId).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || fallbackId;
    while (usedIds.has(id)) id = `${id}-${index + 1}`.slice(0, 40);
    usedIds.add(id);
    const legacyType = ['image', 'pdf'].includes(view?.type) ? 'drive' : view?.type;
    return {
      id,
      name: String(view?.name || `Vista ${index + 1}`).trim().slice(0, 60) || `Vista ${index + 1}`,
      duration: Math.min(300, Math.max(5, Math.round(Number(view?.duration) || 20))),
      modules: [...AVAILABLE_MODULES],
      type: VIEW_TYPES.includes(legacyType) ? legacyType : 'guardies',
      driveUrl: String(view?.driveUrl || view?.assetUrl || '').slice(0, 2000),
      canvaUrl: String(view?.canvaUrl || '').slice(0, 2000),
    };
  });
}

function screenRef(screenId) {
  return doc(db, 'pantalles', String(screenId || DEFAULT_SCREEN_ID));
}

function publicDayRef(courseId, date) {
  return doc(db, 'cursos', courseId, 'guardiesPublicDays', date);
}

export function normalizeScreenConfig(data = {}) {
  const views = normalizeViews(data);
  const modules = normalizeModules(data.modules);
  const forcedViewId = views.some((view) => view.id === data.forcedViewId) ? data.forcedViewId : '';
  return {
    ...DEFAULT_SCREEN_CONFIG,
    ...data,
    active: data.active !== false,
    dateMode: ['today', 'tomorrow', 'specific'].includes(data.dateMode) ? data.dateMode : 'today',
    theme: ['light', 'dark'].includes(data.theme) ? data.theme : 'light',
    scale: Math.min(140, Math.max(80, Math.round(Number(data.scale) || 100))),
    modules: modules.length ? modules : [...views[0].modules],
    views,
    forcedViewId,
    message: String(data.message || '').trim().slice(0, 240),
  };
}

export function subscribeScreenConfig(screenId, onChange, onError = () => {}) {
  if (E2E_AUTH_BYPASS) {
    const key = `${E2E_SCREEN_PREFIX}${screenId}`;
    const emit = () => {
      try {
        const raw = localStorage.getItem(key);
        onChange(normalizeScreenConfig(raw ? JSON.parse(raw) : { courseId: E2E_CURS_ID }), Boolean(raw));
      } catch (error) {
        onError(error);
      }
    };
    emit();
    const listener = (event) => { if (event.key === key) emit(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
  return onSnapshot(screenRef(screenId), (snapshot) => {
    onChange(normalizeScreenConfig(snapshot.exists() ? snapshot.data() : {}), snapshot.exists());
  }, onError);
}

export function subscribePublicGuardiesDay(courseId, date, onChange, onError = () => {}) {
  if (!courseId || !date) return () => {};
  if (E2E_AUTH_BYPASS) {
    const key = `${E2E_GUARDIES_PREFIX}${courseId}`;
    const emit = () => {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        onChange(data.publicDays?.[date] || null);
      } catch (error) {
        onError(error);
      }
    };
    emit();
    const listener = (event) => { if (event.key === key) emit(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
  const observe = createSnapshotState();
  return onSnapshot(publicDayRef(courseId, date), { includeMetadataChanges: true }, (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : null;
    onChange(data && ['published', 'closed'].includes(data.status) ? data : null, observe(snapshot));
  }, onError);
}

export async function saveScreenConfig(screenId, config) {
  const clean = normalizeScreenConfig(config);
  if (E2E_AUTH_BYPASS) {
    localStorage.setItem(`${E2E_SCREEN_PREFIX}${screenId}`, JSON.stringify(clean));
    return clean;
  }
  await setDoc(screenRef(screenId), {
    ...clean,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return clean;
}

export async function savePublicGuardiesDay(courseId, date, projection) {
  if (E2E_AUTH_BYPASS) {
    const key = `${E2E_GUARDIES_PREFIX}${courseId}`;
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    const day = data.days?.[date];
    if (projection ? (Number(day?.revision) || 0) !== (Number(projection.revision) || 0)
      : ['published', 'closed'].includes(day?.status)) return false;
    const next = publicProjectionForDay(projection, day, courseId, date);
    if (publicProjectionsEqual(data.publicDays?.[date] || null, next)) return true;
    data.publicDays ||= {};
    if (next) data.publicDays[date] = next;
    else delete data.publicDays[date];
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  }
  const reference = publicDayRef(courseId, date);
  const publicSnapshot = await getDoc(reference);
  trackReads('publicProjectionCheck', 1, date, publicSnapshot.metadata.fromCache);
  const expected = projection ? { ...projection, schemaVersion: 1, courseId, date } : null;
  if (!publicSnapshot.metadata.fromCache && publicProjectionsEqual(publicSnapshot.exists() ? publicSnapshot.data() : null, expected)) return true;
  return runTransaction(db, async (transaction) => {
    const [privateSnapshot, currentPublic] = await Promise.all([
      transaction.get(doc(db, 'cursos', courseId, 'guardiesDays', date)), transaction.get(reference),
    ]);
    trackReads('publicProjectionRepair', 2, date);
    const day = privateSnapshot.exists() ? privateSnapshot.data() : null;
    // A delayed repair from another tab must not resurrect or overwrite a newer day.
    if (projection ? (Number(day?.revision) || 0) !== (Number(projection.revision) || 0) || day?.status !== projection.status
      : ['published', 'closed'].includes(day?.status)) return false;
    const next = publicProjectionForDay(projection, day, courseId, date);
    if (!publicProjectionsEqual(currentPublic.exists() ? currentPublic.data() : null, next)) {
      writePublicGuardiesDay(transaction, courseId, date, next, day);
    }
    return true;
  });
}

// Called from the private-day transaction: both documents commit together.
export function writePublicGuardiesDay(transaction, courseId, date, projection, day) {
  const next = publicProjectionForDay(projection, day, courseId, date);
  const reference = publicDayRef(courseId, date);
  if (next) transaction.set(reference, { ...next, updatedAt: serverTimestamp() });
  else transaction.delete(reference);
}

export function waitForPantallesUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function isPantallesAdmin() {
  if (E2E_AUTH_BYPASS) return true;
  const user = await waitForPantallesUser();
  if (!user) return false;
  const snapshot = await getDoc(doc(db, 'usuaris', user.uid));
  return snapshot.exists() && snapshot.data()?.rol === 'admin';
}
