// Jornada pública de Guàrdies (cursos/{curs}/guardiesPublicDays/{data}), la que llegeixen
// la vista del professorat i Pantalles. La configuració de les pantalles és a Pantalles.
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { E2E_AUTH_BYPASS } from './e2e';
import { createSnapshotState } from '../utils/snapshotState.js';
import { publicProjectionForDay, publicProjectionsEqual } from '../modules/guardies/domain/publication.js';
import { trackReads } from '../utils/diagnostics.js';

const E2E_GUARDIES_PREFIX = 'quota-e2e-guardies:';

function publicDayRef(courseId, date) {
  return doc(db, 'cursos', courseId, 'guardiesPublicDays', date);
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
