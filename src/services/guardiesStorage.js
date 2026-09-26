import {
  collection,
  deleteDoc,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';
import { auth, authPersistenceReady, db, isIOSWebKit } from '../firebase';
import { BatchSplit } from '../utils/firestoreBatch';
import { getRestCollection, getRestDocument } from './firestoreRest';
import { E2E_AUTH_BYPASS, E2E_CURS_ID, getE2ECollection } from './e2e';
import { subscribePublicGuardiesDay, writePublicGuardiesDay } from './pantallesStorage';
import { publicProjectionForDay } from '../modules/guardies/domain/publication.js';
import { selectDefaultAcademicCourse } from '../utils/academicCourse';
import { trackReads } from '../utils/diagnostics';
import { createSnapshotState } from '../utils/snapshotState.js';
import { normalizePatioConfig } from '../modules/guardies/domain/patio';
import {
  normalizeGuardCount,
  normalizeCountedAssignment,
  updateGuardCounts,
} from '../modules/guardies/domain/workflow';
import { GUARD_HISTORY_VERSION } from '../modules/guardies/domain/guard-history.js';

const FILE_KINDS = new Set(['reference', 'untis', 'duties']);
const DELETABLE_FILE_KINDS = new Set([...FILE_KINDS, 'schedule']);
const MAX_FILE_BYTES = 850 * 1024;
const E2E_PREFIX = 'quota-e2e-guardies:';
const STAFF_DOMAIN = 'iesjosepsuredaiblanes.com';
const DIR_CACHE_PREFIX = 'quota_guardies_teacher_dir:';
const DIR_CACHE_TTL = 60 * 60 * 1000;

function getE2EData(cursId) {
  const raw = localStorage.getItem(`${E2E_PREFIX}${cursId}`);
  if (!raw) return { files: {}, convivencia: {} };
  try {
    return JSON.parse(raw);
  } catch {
    return { files: {}, convivencia: {} };
  }
}

function setE2EData(cursId, data) {
  localStorage.setItem(`${E2E_PREFIX}${cursId}`, JSON.stringify(data));
}

function subscribeE2E(cursId, callback) {
  let active = true;
  const key = `${E2E_PREFIX}${cursId}`;
  const listener = (event) => {
    if (event.key === key) callback(getE2EData(cursId));
  };
  window.addEventListener('storage', listener);
  queueMicrotask(() => { if (active) callback(getE2EData(cursId)); });
  return () => { active = false; window.removeEventListener('storage', listener); };
}

function guardiesRef(cursId, id) {
  if (!cursId) throw new Error('No hi ha cap curs acadèmic disponible.');
  return doc(db, 'cursos', cursId, 'guardies', id);
}

function guardiesDayRef(cursId, date) {
  if (!cursId) throw new Error('No hi ha cap curs acadèmic disponible.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('La data de guàrdies no és vàlida.');
  return doc(db, 'cursos', cursId, 'guardiesDays', date);
}

function guardiesStatsRef(cursId) {
  return guardiesRef(cursId, 'stats');
}

function cleanGuardGroups(groups) {
  return Array.from(new Set(groups.map((group) => String(group || '').trim()).filter(Boolean)));
}

// Accepta el format v1 (data -> [grups]) i el v2 (data -> { "dia|hora": [grups] }).
function cleanGuardHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([teacherId, dates]) => [
    String(teacherId),
    Object.fromEntries(Object.entries(dates && typeof dates === 'object' ? dates : {})
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, entry]) => {
        if (Array.isArray(entry)) return [date, cleanGuardGroups(entry)];
        if (entry && typeof entry === 'object') {
          return [date, Object.fromEntries(Object.entries(entry)
            .filter(([slot, groups]) => String(slot || '').trim() && Array.isArray(groups))
            .map(([slot, groups]) => [String(slot).trim(), cleanGuardGroups(groups)]))];
        }
        return null;
      })
      .filter(Boolean)),
  ]));
}

function changeGuardHistoryDate(history, date, entries = [], remove = false) {
  const next = cleanGuardHistory(history);
  Object.keys(next).forEach((teacherId) => {
    delete next[teacherId][date];
    if (!Object.keys(next[teacherId]).length) delete next[teacherId];
  });
  if (!remove) entries.forEach(({ teacherId, slot, groups }) => {
    const cleanSlot = String(slot || '').trim();
    if (!teacherId || !cleanSlot) return;
    next[teacherId] ||= {};
    next[teacherId][date] ||= {};
    next[teacherId][date][cleanSlot] = cleanGuardGroups([
      ...(next[teacherId][date][cleanSlot] || []),
      ...(groups || []),
    ]);
  });
  return next;
}

function directoryVersionRef(cursId) {
  return guardiesRef(cursId, 'directoriVersion');
}

function loadCachedTeacherDirectory(cursId) {
  try {
    const raw = localStorage.getItem(`${DIR_CACHE_PREFIX}${cursId}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!Array.isArray(entry?.data)) return null;
    // A cache without a server-side version cannot be invalidated reliably.
    // Ignore entries created before directory versioning was enabled.
    if (!(Number(entry?.version) > 0)) return null;
    if (Date.now() - (entry.savedAt || 0) > DIR_CACHE_TTL) return null;
    return entry;
  } catch {
    return null;
  }
}

function saveCachedTeacherDirectory(cursId, data, version) {
  try {
    localStorage.setItem(`${DIR_CACHE_PREFIX}${cursId}`, JSON.stringify({
      data,
      version: Number(version) || 0,
      savedAt: Date.now(),
    }));
  } catch {}
}

function clearCachedTeacherDirectory(cursId) {
  try {
    localStorage.removeItem(`${DIR_CACHE_PREFIX}${cursId}`);
  } catch {}
}

function guardiesExclusionsRef(cursId) {
  if (!cursId) throw new Error('No hi ha cap curs acadèmic disponible.');
  return doc(db, 'cursos', cursId, 'config', 'guardies-exclusions');
}

function guardiesObservationsRef(cursId) {
  if (!cursId) throw new Error('No hi ha cap curs acadèmic disponible.');
  return doc(db, 'cursos', cursId, 'config', 'guardies-observations');
}

async function normalizeFile(data) {
  if (!data?.text) return null;
  return {
    text: data.text,
    name: data.name || 'fitxer',
    size: Number(data.size) || new TextEncoder().encode(data.text).byteLength,
  };
}

async function loadStoredFile(data) {
  if (!data) return null;
  if (data.text) return normalizeFile(data);
  return null;
}

function isOfflineError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return error?.code === 'unavailable' || message.includes('client is offline');
}

async function withNetworkRetry(operation) {
  const delays = [0, 400, 1200, 2500];
  let lastError;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await operation();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      lastError = error;
    }
    await enableNetwork(db).catch(() => {});
  }
  throw lastError;
}

function readDoc(reference) {
  if (!isIOSWebKit) return getDoc(reference);
  return getRestDocument(reference.path);
}

function readCollection(reference) {
  if (!isIOSWebKit) return getDocs(reference);
  return getRestCollection(reference.path);
}

function subscribeWithPolling(load, onChange, onError, interval = 5000) {
  let active = true;
  let timer = null;
  let running = false;
  let firstPoll = true;
  const poll = async () => {
    if (!active || running) return;
    if (document.hidden && !firstPoll) {
      timer = window.setTimeout(poll, interval);
      return;
    }
    running = true;
    firstPoll = false;
    try {
      const data = await load();
      if (active) await onChange(data);
    } catch (error) {
      if (active) onError(error);
    } finally {
      running = false;
      if (active) timer = window.setTimeout(poll, interval);
    }
  };
  timer = window.setTimeout(poll, 0);
  return () => {
    active = false;
    if (timer) window.clearTimeout(timer);
  };
}

function normalizeConvivencia(data) {
  return data?.assignacions && typeof data.assignacions === 'object'
    ? data.assignacions
    : {};
}

function normalizePati(data) {
  if (!data || typeof data !== 'object') return null;
  return normalizePatioConfig(data, { startYear: data.startYear });
}

function normalizeExcludedTeacherIds(data) {
  return Array.from(new Set((Array.isArray(data?.teacherIds) ? data.teacherIds : [])
    .map((teacherId) => String(teacherId || '').trim())
    .filter(Boolean)))
    .slice(0, 500);
}

export function normalizeGuardiesObservationPresets(data) {
  const values = Array.isArray(data) ? data : data?.phrases;
  const unique = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const phrase = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const key = phrase.toLocaleLowerCase('ca');
    if (phrase && !unique.has(key)) unique.set(key, phrase);
  });
  return Array.from(unique.values()).slice(0, 50);
}

function personNameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join('|');
}

function validateFile(kind, text, name) {
  if (!FILE_KINDS.has(kind)) throw new Error('Tipus de fitxer de guàrdies no reconegut.');
  const cleanText = String(text || '');
  const size = new TextEncoder().encode(cleanText).byteLength;
  if (!cleanText.trim()) throw new Error('El fitxer està buit.');
  if (size > MAX_FILE_BYTES) throw new Error('El fitxer supera el límit de 850 KB.');
  return {
    kind,
    text: cleanText,
    name: String(name || 'fitxer').slice(0, 180),
    size,
  };
}

function waitForUser() {
  if (E2E_AUTH_BYPASS) return Promise.resolve({ uid: 'e2e-admin' });
  return authPersistenceReady.then(() => {
    if (auth.currentUser) return auth.currentUser;
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  });
}

export async function signInGuardies() {
  await authPersistenceReady;
  await setPersistence(auth, browserLocalPersistence).catch(() => {});
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: STAFF_DOMAIN, prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
    return true;
  } catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      throw new Error("Safari ha bloquejat l'inici de sessió. Permet les finestres emergents i torna-ho a provar.");
    }
    if (error?.code === 'auth/cancelled-popup-request') return false;
    if (error?.code !== 'auth/popup-closed-by-user') throw error;
    return false;
  }
}

async function resolveCourse(requestedCourseId) {
  if (E2E_AUTH_BYPASS) return { id: E2E_CURS_ID, name: 'E2E 2026-27' };
  if (requestedCourseId && /^[\w-]{1,100}$/.test(requestedCourseId)) {
    try {
      const requested = await withNetworkRetry(() => readDoc(doc(db, 'cursos', requestedCourseId)));
      if (requested.exists()) return { id: requested.id, name: requested.data().nom || requested.id };
    } catch (error) {
      if (isOfflineError(error)) return { id: requestedCourseId, name: requestedCourseId };
      throw error;
    }
  }
  const snapshot = await withNetworkRetry(() => readCollection(collection(db, 'cursos')));
  const courses = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => b.id.localeCompare(a.id, 'ca', { numeric: true }));
  const selected = courses.find((course) => course.id === requestedCourseId)
    || selectDefaultAcademicCourse(courses);
  if (!selected) throw new Error('No hi ha cap curs acadèmic configurat.');
  return { id: selected.id, name: selected.nom || selected.id };
}

export async function getGuardiesContext(requestedCourseId = '', { teacherView = false } = {}) {
  if (E2E_AUTH_BYPASS) {
    return {
      user: { uid: 'e2e-admin', displayName: 'E2E Admin', email: 'e2e.admin@iesjosepsuredaiblanes.com' },
      course: await resolveCourse(requestedCourseId),
      role: 'admin',
      isAdmin: true,
      teacherView,
      canWrite: !teacherView,
    };
  }

  const user = await waitForUser();
  if (!user) throw new Error('Inicia sessió per accedir a les dades de guàrdies.');
  const userSnapshot = await withNetworkRetry(() => readDoc(doc(db, 'usuaris', user.uid)));
  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const role = profile.rol || '';
  const isAdmin = role === 'admin';
  return {
    user: {
      uid: user.uid,
      displayName: profile.nom || user.displayName || '',
      email: profile.email || user.email || '',
    },
    course: await resolveCourse(requestedCourseId),
    role,
    isAdmin,
    teacherView: !isAdmin || teacherView,
    canWrite: isAdmin && !teacherView,
  };
}

export async function loadGuardiesData(cursId) {
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    return {
      files: {
        reference: data.files.reference || null,
        untis: data.files.untis || null,
        duties: data.files.duties || null,
      },
      convivencia: data.convivencia || {},
      pati: normalizePati(data.pati),
      observationPresets: normalizeGuardiesObservationPresets(data.observationPresets),
      excludedTeacherIds: normalizeExcludedTeacherIds({ teacherIds: data.excludedTeacherIds }),
    };
  }

  const [reference, untis, duties, convivencia, pati, observations, exclusions] = await withNetworkRetry(() => Promise.all([
    readDoc(guardiesRef(cursId, 'reference')),
    readDoc(guardiesRef(cursId, 'untis')),
    readDoc(guardiesRef(cursId, 'duties')),
    readDoc(guardiesRef(cursId, 'convivencia')),
    readDoc(guardiesRef(cursId, 'pati')),
    readDoc(guardiesObservationsRef(cursId)),
    readDoc(guardiesExclusionsRef(cursId)),
  ]));
  trackReads('configLoad', 7);
  return {
    files: {
      reference: reference.exists() ? await loadStoredFile(reference.data()) : null,
      untis: untis.exists() ? await loadStoredFile(untis.data()) : null,
      duties: duties.exists() ? await loadStoredFile(duties.data()) : null,
    },
    convivencia: convivencia.exists() ? normalizeConvivencia(convivencia.data()) : {},
    pati: pati.exists() ? normalizePati(pati.data()) : null,
    observationPresets: observations.exists() ? normalizeGuardiesObservationPresets(observations.data()) : [],
    excludedTeacherIds: exclusions.exists() ? normalizeExcludedTeacherIds({ teacherIds: exclusions.data().excludedTeacherIds }) : [],
  };
}

export function subscribeGuardiesData(cursId, onChange, onError = () => {}, { iosPollInterval = 5 * 60 * 1000, onMetadata = () => {} } = {}) {
  if (E2E_AUTH_BYPASS) {
    return subscribeE2E(cursId, (data) => {
      Promise.resolve(onChange({
        files: {
          reference: data.files?.reference || null,
          untis: data.files?.untis || null,
          duties: data.files?.duties || null,
        },
        convivencia: data.convivencia || {},
        pati: normalizePati(data.pati),
        observationPresets: normalizeGuardiesObservationPresets(data.observationPresets),
        excludedTeacherIds: normalizeExcludedTeacherIds({ teacherIds: data.excludedTeacherIds }),
        stats: data.stats || { counts: {} },
      })).catch(onError);
    });
  }

  if (isIOSWebKit) {
    let pollCycle = 0;
    return subscribeWithPolling(async () => {
      pollCycle += 1;
      trackReads('iosPollCycle', 0, `config-poll-#${pollCycle}`);
      const [data, stats] = await Promise.all([
        loadGuardiesData(cursId),
        loadGuardiesStats(cursId),
      ]);
      return { ...data, stats };
    }, onChange, onError, iosPollInterval);
  }

  let guardiesReady = false;
  let exclusionsReady = false;
  let observationsReady = false;
  let documents = new Map();
  let excludedTeacherIds = [];
  let observationPresets = [];
  let active = true;
  let emission = 0;
  const sources = new Map();
  const confirmSource = (key, snapshot) => {
    sources.set(key, snapshot.metadata);
    onMetadata({ fromCache: sources.size < 3 || [...sources.values()].some((s) => s.fromCache),
      hasPendingWrites: [...sources.values()].some((s) => s.hasPendingWrites) });
  };
  const emit = async () => {
    if (!guardiesReady || !exclusionsReady || !observationsReady) return;
    const currentEmission = ++emission;
    const currentDocuments = documents;
    try {
      const files = await Promise.all(['reference', 'untis', 'duties'].map((kind) => loadStoredFile(currentDocuments.get(kind))));
      if (!active || currentEmission !== emission) return;
      await onChange({
        files: {
          reference: files[0],
          untis: files[1],
          duties: files[2],
        },
        convivencia: normalizeConvivencia(documents.get('convivencia')),
        pati: normalizePati(documents.get('pati')),
        observationPresets,
        excludedTeacherIds,
        stats: documents.get('stats') || { counts: {} },
      });
    } catch (error) {
      if (active && currentEmission === emission) onError(error);
    }
  };
  let configSnapshotCount = 0;
  let configServerSeen = false;
  const unsubscribeGuardies = onSnapshot(collection(db, 'cursos', cursId, 'guardies'), { includeMetadataChanges: true }, (snapshot) => {
    confirmSource('guardies', snapshot);
    const relevantDocs = snapshot.docs.filter((item) => item.id !== 'directoriVersion');
    const relevantChanges = snapshot.docChanges().filter((change) => change.doc.id !== 'directoriVersion');
    const versionChanges = snapshot.docChanges().filter((change) => change.doc.id === 'directoriVersion');
    const firstServer = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && !configServerSeen;
    if (firstServer) configServerSeen = true;
    if (!snapshot.metadata.hasPendingWrites && (versionChanges.length > 0 || ((configSnapshotCount === 0 || firstServer) && snapshot.docs.some((d) => d.id === 'directoriVersion')))) {
      const versionReads = configSnapshotCount === 0 || firstServer ? 1 : versionChanges.length;
      trackReads('directoryVersionCollectionSnapshot', versionReads, '', snapshot.metadata.fromCache);
    }
    const reads = snapshot.metadata.hasPendingWrites ? 0
      : configSnapshotCount === 0 || firstServer ? relevantDocs.length : relevantChanges.length;
    if (reads) trackReads('configSnapshot', reads, configSnapshotCount === 0 || firstServer ? 'initial' : 'update', snapshot.metadata.fromCache);
    if (configSnapshotCount > 0 && relevantChanges.length === 0) return;
    configSnapshotCount += 1;
    documents = new Map(relevantDocs.map((item) => [item.id, item.data()]));
    guardiesReady = true;
    emit();
  }, onError);
  const observeExclusions = createSnapshotState();
  const observeObservations = createSnapshotState();
  const unsubscribeExclusions = onSnapshot(guardiesExclusionsRef(cursId), { includeMetadataChanges: true }, (snapshot) => {
    confirmSource('exclusions', snapshot);
    const metadata = observeExclusions(snapshot);
    if (metadata.reads) trackReads('configSnapshot', metadata.reads, 'exclusions', metadata.fromCache);
    if (metadata.metadataOnly) return;
    excludedTeacherIds = snapshot.exists()
      ? normalizeExcludedTeacherIds({ teacherIds: snapshot.data().excludedTeacherIds })
      : [];
    exclusionsReady = true;
    emit();
  }, onError);
  const unsubscribeObservations = onSnapshot(guardiesObservationsRef(cursId), { includeMetadataChanges: true }, (snapshot) => {
    confirmSource('observations', snapshot);
    const metadata = observeObservations(snapshot);
    if (metadata.reads) trackReads('configSnapshot', metadata.reads, 'observations', metadata.fromCache);
    if (metadata.metadataOnly) return;
    observationPresets = snapshot.exists()
      ? normalizeGuardiesObservationPresets(snapshot.data())
      : [];
    observationsReady = true;
    emit();
  }, onError);
  return () => {
    active = false;
    unsubscribeGuardies();
    unsubscribeExclusions();
    unsubscribeObservations();
  };
}

export async function loadGuardiesTeacherDirectory(cursId) {
  if (E2E_AUTH_BYPASS) {
    return [
      { id: 'ADEL', codiUntis: 'ADEL', name: 'Adell Domènech, Marina', email: 'marina.adell@iesjosepsuredaiblanes.com' },
      { id: 'FUEN', codiUntis: 'FUEN', name: 'Fuentes Serra, Gabriel', email: 'gabriel.fuentes@iesjosepsuredaiblanes.com' },
      { id: 'SANZ', codiUntis: 'SANZ', name: 'Sanz Vidal, Clara', email: 'clara.sanz@iesjosepsuredaiblanes.com' },
      { id: 'MAT1', codiUntis: 'MAT1', name: 'Professor Matemàtiques', email: 'matematiques@iesjosepsuredaiblanes.com' },
      ...getE2ECollection('professors').map((teacher) => ({
        id: teacher.id,
        codiUntis: teacher.codiUntis || teacher.id,
        name: teacher.nom || '',
        email: teacher.email || '',
      })),
    ];
  }

  let cached = loadCachedTeacherDirectory(cursId);
  if (cached && isIOSWebKit) {
    const version = await readDoc(directoryVersionRef(cursId));
    trackReads('directoryVersionCheck', 1);
    if (!version.exists() || Number(version.data()?.version) !== Number(cached.version)) cached = null;
  }
  if (cached) {
    trackReads('directoryLoad', 0, 'cache', true);
    return cached.data;
  }

  const [courseSnapshot, profileSnapshots, versionSnapshot] = await Promise.all([
    withNetworkRetry(() => readCollection(collection(db, 'cursos', cursId, 'professors'))),
    Promise.all([
      collection(db, 'usuaris'),
      collection(db, 'preautoritzats'),
    ].map((reference) => withNetworkRetry(() => readCollection(reference)).catch(() => null))),
    readDoc(directoryVersionRef(cursId)).catch(() => null),
  ]);
  const directoryReadCount = courseSnapshot.docs.length
    + profileSnapshots.reduce((sum, s) => sum + (s?.docs?.length || 0), 0)
    + 1;
  trackReads('directoryLoad', directoryReadCount, `professors:${courseSnapshot.docs.length}`);
  const profiles = profileSnapshots
    .flatMap((snapshot) => snapshot?.docs || [])
    .map((item) => ({
      ...item.data(),
      id: item.id,
    }));
  const emailByCode = new Map();
  const emailByName = new Map();
  profiles.forEach((profile) => {
    const email = String(profile.email || (String(profile.id).includes('@') ? profile.id : '')).trim();
    if (!email) return;
    const code = String(profile.codiUntis || '').trim();
    const nameKey = personNameKey(profile.nom || profile.name || profile.displayName);
    if (code) emailByCode.set(code.toLowerCase(), email);
    if (nameKey) emailByName.set(nameKey, email);
  });
  const directory = courseSnapshot.docs.map((item) => {
    const data = item.data();
    const codiUntis = String(data.codiUntis || item.id).trim();
    const name = String(data.nom || '').trim();
    return {
      id: item.id,
      codiUntis,
      name,
      email: String(data.email || emailByCode.get(codiUntis.toLowerCase()) || emailByName.get(personNameKey(name)) || '').trim(),
    };
  });
  const currentVersion = versionSnapshot?.exists() ? Number(versionSnapshot.data()?.version) || 0 : 0;
  // Do not enable caching until Quota has created the version document. This
  // preserves the previous fresh-read behaviour during a staged deployment.
  if (currentVersion > 0) {
    saveCachedTeacherDirectory(cursId, directory, currentVersion);
  }
  return directory;
}

export function subscribeDirectoryVersion(cursId, onOutdated, onError = () => {}) {
  if (E2E_AUTH_BYPASS || isIOSWebKit) return () => {};
  const observe = createSnapshotState();
  return onSnapshot(directoryVersionRef(cursId), { includeMetadataChanges: true }, (snapshot) => {
    const metadata = observe(snapshot);
    if (!snapshot.exists() || metadata.fromCache || metadata.hasPendingWrites) return;
    if (metadata.reads) trackReads('directoryVersionSnapshot', metadata.reads, 'server', false);
    const remoteVersion = Number(snapshot.data()?.version) || 0;
    if (!remoteVersion) return;
    const cached = loadCachedTeacherDirectory(cursId);
    const cachedVersion = Number(cached?.version) || 0;
    if (remoteVersion > cachedVersion) {
      clearCachedTeacherDirectory(cursId);
      onOutdated();
    }
  }, onError);
}

export async function bumpDirectoryVersion(cursId, userId = '') {
  await setDoc(directoryVersionRef(cursId), {
    version: Date.now(),
    updatedAt: serverTimestamp(),
    updatedBy: userId || '',
  });
  // The administrator who requested the refresh must not read their own old
  // cache while their snapshot notification is still arriving.
  clearCachedTeacherDirectory(cursId);
}

export async function saveGuardiesExcludedTeachers(cursId, teacherIds) {
  const clean = normalizeExcludedTeacherIds({ teacherIds });
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.excludedTeacherIds = clean;
    setE2EData(cursId, data);
    return clean;
  }
  await setDoc(guardiesExclusionsRef(cursId), {
    excludedTeacherIds: clean,
    updatedAt: serverTimestamp(),
  });
  return clean;
}

export async function loadGuardiesStats(cursId) {
  if (E2E_AUTH_BYPASS) {
    return getE2EData(cursId).stats || { counts: {} };
  }
  const snapshot = await withNetworkRetry(() => readDoc(guardiesStatsRef(cursId)));
  trackReads('statsLoad', 1);
  return snapshot.exists() ? snapshot.data() : { counts: {} };
}

// Horari mínim per al recompte del professorat: els tres fitxers i les
// exclusions, llegits una sola vegada. Convivència, pati i observacions no hi
// intervenen, i els fitxers canvien poques vegades per curs.
export async function loadGuardiesTeacherSchedule(cursId) {
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    return {
      files: {
        reference: data.files?.reference || null,
        untis: data.files?.untis || null,
        duties: data.files?.duties || null,
      },
      excludedTeacherIds: normalizeExcludedTeacherIds({ teacherIds: data.excludedTeacherIds }),
    };
  }
  const [reference, untis, duties, exclusions] = await withNetworkRetry(() => Promise.all([
    readDoc(guardiesRef(cursId, 'reference')),
    readDoc(guardiesRef(cursId, 'untis')),
    readDoc(guardiesRef(cursId, 'duties')),
    readDoc(guardiesExclusionsRef(cursId)),
  ]));
  trackReads('teacherScheduleLoad', 4);
  return {
    files: {
      reference: reference.exists() ? await loadStoredFile(reference.data()) : null,
      untis: untis.exists() ? await loadStoredFile(untis.data()) : null,
      duties: duties.exists() ? await loadStoredFile(duties.data()) : null,
    },
    excludedTeacherIds: exclusions.exists() ? normalizeExcludedTeacherIds({ teacherIds: exclusions.data().excludedTeacherIds }) : [],
  };
}

// Només el document de recomptes. Les confirmacions de caché/servidor sense
// canvis de contingut no es notifiquen.
export function subscribeGuardiesStats(cursId, onChange, onError = () => {}, { iosPollInterval = 5 * 60 * 1000 } = {}) {
  if (E2E_AUTH_BYPASS) {
    let signature;
    return subscribeE2E(cursId, (data) => {
      const stats = data.stats || { counts: {} };
      const next = JSON.stringify(stats);
      if (next === signature) return;
      signature = next;
      onChange(stats);
    });
  }
  if (isIOSWebKit) {
    let signature;
    return subscribeWithPolling(() => loadGuardiesStats(cursId), (stats) => {
      const next = JSON.stringify(stats);
      if (next === signature) return;
      signature = next;
      onChange(stats);
    }, onError, iosPollInterval);
  }
  const observe = createSnapshotState();
  return onSnapshot(guardiesStatsRef(cursId), { includeMetadataChanges: true }, (snapshot) => {
    const metadata = observe(snapshot);
    if (metadata.reads) trackReads('statsSnapshot', metadata.reads, '', metadata.fromCache);
    if (metadata.metadataOnly) return;
    onChange(snapshot.exists() ? snapshot.data() : { counts: {} });
  }, onError);
}

export async function setGuardiesTeacherCount(cursId, teacherId, source, value, slot = '') {
  const cleanTeacherId = String(teacherId || '').trim();
  if (!['released', 'guard'].includes(source)) throw new Error('Tipus de recompte no vàlid.');
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  const cleanSlot = String(slot || '').trim();
  if (!cleanTeacherId) throw new Error('Professor no vàlid.');
  if (source === 'guard' && !cleanSlot) throw new Error('Franja de guàrdia no vàlida.');

  const withManualCount = (raw) => {
    const current = normalizeGuardCount(raw);
    if (source === 'released') {
      return { ...current, released: count, total: count + current.guard + current.other };
    }
    const guardSlots = { ...current.guardSlots };
    if (count) guardSlots[cleanSlot] = count;
    else delete guardSlots[cleanSlot];
    const guard = current.guardLegacy + Object.values(guardSlots).reduce((sum, slotCount) => sum + slotCount, 0);
    return { ...current, guard, guardSlots, total: current.released + guard + current.other };
  };

  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.stats ||= { counts: {} };
    data.stats.counts ||= {};
    data.stats.counts[cleanTeacherId] = withManualCount(data.stats.counts?.[cleanTeacherId]);
    setE2EData(cursId, data);
    return data.stats;
  }

  return runTransaction(db, async (transaction) => {
    const reference = guardiesStatsRef(cursId);
    const snapshot = await transaction.get(reference);
    const stats = snapshot.exists() ? snapshot.data() : { counts: {} };
    const counts = { ...(stats.counts || {}) };
    counts[cleanTeacherId] = withManualCount(counts[cleanTeacherId]);
    transaction.set(reference, {
      counts,
      guardHistory: stats.guardHistory || {},
      guardHistoryVersion: Number(stats.guardHistoryVersion) || 0,
      updatedAt: serverTimestamp(),
    });
    return { counts };
  });
}

export function setGuardiesTeacherGuardCount(cursId, teacherId, value, slot) {
  return setGuardiesTeacherCount(cursId, teacherId, 'guard', value, slot);
}

export async function resetGuardiesCourseData(cursId) {
  if (!cursId) throw new Error('No hi ha cap curs acadèmic disponible.');
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    const deletedDays = Object.keys(data.days || {}).length;
    data.days = {};
    data.publicDays = {};
    data.stats = { counts: {} };
    setE2EData(cursId, data);
    return { deletedDays };
  }

  const [days, publicDays] = await Promise.all([
    getDocs(collection(db, 'cursos', cursId, 'guardiesDays')),
    getDocs(collection(db, 'cursos', cursId, 'guardiesPublicDays')),
  ]);
  const batch = new BatchSplit();
  const clientUpdatedAt = new Date().toISOString();
  days.docs.forEach((snapshot) => batch.set(snapshot.ref, {
    schemaVersion: 1,
    date: snapshot.id,
    status: 'draft',
    absenceIds: [],
    assignments: {},
    comments: {},
    groupsOut: [],
    groupTeachers: {},
    groupReleasedTeachers: {},
    partialGroups: [],
    outingAbsenceIds: [],
    cancelledAssignments: [],
    publishedAt: '',
    closedAt: '',
    countedAssignments: [],
    clientUpdatedAt,
    revision: Math.max(0, Number(snapshot.data()?.revision) || 0) + 1,
    updatedAt: serverTimestamp(),
  }));
  publicDays.docs.forEach((snapshot) => batch.delete(snapshot.ref));
  batch.set(guardiesStatsRef(cursId), { counts: {}, guardHistory: {}, guardHistoryVersion: GUARD_HISTORY_VERSION, updatedAt: serverTimestamp() });
  await batch.commit();
  return { deletedDays: days.size };
}

export async function saveGuardiesFile(cursId, kind, text, name) {
  const file = validateFile(kind, text, name);
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.files[kind] = file;
    setE2EData(cursId, data);
    return file;
  }
  await setDoc(guardiesRef(cursId, kind), {
    kind: file.kind,
    name: file.name,
    size: file.size,
    text: file.text,
    encoding: 'utf-8',
    updatedAt: serverTimestamp(),
  });
  return file;
}

export async function deleteGuardiesFile(cursId, kind) {
  if (!DELETABLE_FILE_KINDS.has(kind)) return;
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    delete data.files[kind];
    setE2EData(cursId, data);
    return;
  }
  await deleteDoc(guardiesRef(cursId, kind));
}

export async function saveGuardiesConvivencia(cursId, assignacions) {
  const cleanAssignments = assignacions && typeof assignacions === 'object' ? assignacions : {};
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.convivencia = cleanAssignments;
    setE2EData(cursId, data);
    return;
  }
  await setDoc(guardiesRef(cursId, 'convivencia'), {
    assignacions: cleanAssignments,
    updatedAt: serverTimestamp(),
  });
}

export async function saveGuardiesPati(cursId, config) {
  const clean = normalizePatioConfig(config, { startYear: config?.startYear });
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.pati = clean;
    setE2EData(cursId, data);
    return clean;
  }
  await setDoc(guardiesRef(cursId, 'pati'), {
    ...clean,
    updatedAt: serverTimestamp(),
  });
  return clean;
}

export async function saveGuardiesObservationPresets(cursId, phrases) {
  const clean = normalizeGuardiesObservationPresets(phrases);
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.observationPresets = clean;
    setE2EData(cursId, data);
    return clean;
  }
  await setDoc(guardiesObservationsRef(cursId), {
    phrases: clean,
    updatedAt: serverTimestamp(),
  });
  return clean;
}

export async function loadGuardiesDay(cursId, date, { publishedOnly = false } = {}) {
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    const day = data.days?.[date] || null;
    return publishedOnly && !['published', 'closed'].includes(day?.status) ? null : day;
  }
  try {
    const snapshot = await withNetworkRetry(() => readDoc(guardiesDayRef(cursId, date)));
    trackReads('dayLoad', 1, date);
    const day = snapshot.exists() ? snapshot.data() : null;
    return publishedOnly && !['published', 'closed'].includes(day?.status) ? null : day;
  } catch (error) {
    if (publishedOnly && error?.code === 'permission-denied') return null;
    throw error;
  }
}

function guardiesDayNeedsClosing(day = {}) {
  if (day.status === 'closed') return false;
  if (day.status === 'published') return true;
  return Boolean(
    day.absenceIds?.length
    || day.groupsOut?.length
    || Object.keys(day.assignments || {}).length
    || Object.keys(day.comments || {}).length
  );
}

export async function loadUnclosedGuardiesDays(cursId, beforeDate) {
  if (!cursId || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate || '')) return [];
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    return Object.entries(data.days || {})
      .filter(([date, day]) => date < beforeDate && guardiesDayNeedsClosing(day))
      .map(([date]) => date)
      .sort();
  }
  const snapshot = await getDocs(query(
    collection(db, 'cursos', cursId, 'guardiesDays'),
    where('status', 'in', ['draft', 'published']),
  ));
  trackReads('unclosedDaysLoad', snapshot.docs.length, `total:${snapshot.docs.length}`);
  return snapshot.docs
    .filter((item) => item.id < beforeDate && guardiesDayNeedsClosing(item.data()))
    .map((item) => item.id)
    .sort();
}

export function subscribeGuardiesDay(
  cursId,
  date,
  onChange,
  onError = () => {},
  { publishedOnly = false, iosPollInterval = 60 * 1000 } = {},
) {
  if (E2E_AUTH_BYPASS) {
    return subscribeE2E(cursId, (data) => {
      const day = data.days?.[date] || null;
      onChange(publishedOnly && !['published', 'closed'].includes(day?.status) ? null : day, {
        fromCache: false,
        hasPendingWrites: false,
      });
    });
  }

  if (isIOSWebKit) {
    let dayPollCycle = 0;
    return subscribeWithPolling(
      () => {
        dayPollCycle += 1;
        trackReads('iosPollCycle', 0, `day-poll-#${dayPollCycle}`);
        return loadGuardiesDay(cursId, date, { publishedOnly });
      },
      (day) => onChange(day, { fromCache: false, hasPendingWrites: false }),
      onError,
      iosPollInterval,
    );
  }

  if (publishedOnly) {
    let unsubscribePrivate = () => {};
    let privateActive = false;
    const stopPrivate = () => {
      unsubscribePrivate();
      unsubscribePrivate = () => {};
      privateActive = false;
    };
    const unsubscribePublic = subscribePublicGuardiesDay(cursId, date, (publicDay, metadata = {}) => {
      if (metadata.reads ?? 1) trackReads('dayPublicSignalSnapshot', metadata.reads ?? 1, publicDay ? 'published' : 'not-published', metadata.fromCache);
      if (!publicDay) {
        // Despublication: stop the private subscription before reporting null.
        stopPrivate();
        onChange(null, metadata);
        return;
      }
      if (privateActive) return;
      privateActive = true;
      const observe = createSnapshotState();
      unsubscribePrivate = onSnapshot(guardiesDayRef(cursId, date), { includeMetadataChanges: true }, (snapshot) => {
        const metadata = observe(snapshot);
        if (metadata.reads) trackReads('daySnapshot', metadata.reads, 'published-document', metadata.fromCache);
        const day = snapshot.exists() && ['published', 'closed'].includes(snapshot.data()?.status)
          ? snapshot.data()
          : null;
        onChange(day, metadata);
      }, (error) => {
        stopPrivate();
        onError(error);
      });
    }, onError);
    return () => {
      stopPrivate();
      unsubscribePublic();
    };
  }

  const observe = createSnapshotState();
  return onSnapshot(guardiesDayRef(cursId, date), { includeMetadataChanges: true }, (snapshot) => {
    const metadata = observe(snapshot);
    if (metadata.reads) trackReads('daySnapshot', metadata.reads, '', metadata.fromCache);
    onChange(snapshot.exists() ? snapshot.data() : null, metadata);
  }, onError);
}

export function subscribeGuardiesPublicView(cursId, date, onChange, onError = () => {}) {
  if (!isIOSWebKit || E2E_AUTH_BYPASS) {
    return subscribePublicGuardiesDay(cursId, date, (day, metadata) => {
      if (metadata?.reads ?? 1) trackReads('publicDaySnapshot', metadata?.reads ?? 1, date, metadata?.fromCache);
      onChange(day, metadata);
    }, onError);
  }
  return subscribeWithPolling(async () => {
    const snapshot = await readDoc(doc(db, 'cursos', cursId, 'guardiesPublicDays', date));
    trackReads('publicDayPoll', 1, date);
    const day = snapshot.exists() ? snapshot.data() : null;
    return ['published', 'closed'].includes(day?.status) ? day : null;
  }, (day) => onChange(day, { fromCache: false }), onError, 60 * 1000);
}

export async function saveGuardiesDay(cursId, date, payload, expectedRevision = 0, { publicProjection } = {}) {
  const clean = {
    schemaVersion: 1,
    date,
    status: payload.status || 'draft',
    absenceIds: Array.from(new Set(payload.absenceIds || [])).filter(Boolean),
    assignments: payload.assignments && typeof payload.assignments === 'object' ? payload.assignments : {},
    comments: payload.comments && typeof payload.comments === 'object' ? payload.comments : {},
    groupsOut: Array.from(new Set(payload.groupsOut || [])).filter(Boolean),
    groupTeachers: payload.groupTeachers && typeof payload.groupTeachers === 'object' ? payload.groupTeachers : {},
    groupReleasedTeachers: payload.groupReleasedTeachers && typeof payload.groupReleasedTeachers === 'object' ? payload.groupReleasedTeachers : {},
    partialGroups: Array.from(new Set(payload.partialGroups || [])).filter(Boolean),
    outingAbsenceIds: Array.from(new Set(payload.outingAbsenceIds || [])).filter(Boolean),
    cancelledAssignments: Array.from(new Set(payload.cancelledAssignments || [])).filter(Boolean),
    overriddenCoTeacherAssignments: Array.from(new Set(payload.overriddenCoTeacherAssignments || [])).filter(Boolean),
    publishedAt: String(payload.publishedAt || ''),
    closedAt: String(payload.closedAt || ''),
    countedAssignments: Array.isArray(payload.countedAssignments) ? payload.countedAssignments.filter(Boolean) : [],
  };
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.days ||= {};
    const currentRevision = Number(data.days[date]?.revision) || 0;
    if (currentRevision !== expectedRevision) throw Object.assign(new Error('La jornada ha canviat en una altra pestanya.'), { code: 'guardies/conflict' });
    data.days[date] = { ...clean, revision: currentRevision + 1, clientUpdatedAt: new Date().toISOString() };
    if (publicProjection !== undefined) {
      data.publicDays ||= {};
      const next = publicProjectionForDay(publicProjection, data.days[date], cursId, date);
      if (next) data.publicDays[date] = next;
      else delete data.publicDays[date];
    }
    setE2EData(cursId, data);
    return data.days[date];
  }
  return runTransaction(db, async (transaction) => {
    const reference = guardiesDayRef(cursId, date);
    const snapshot = await transaction.get(reference);
    const currentRevision = snapshot.exists() ? Number(snapshot.data().revision) || 0 : 0;
    if (currentRevision !== expectedRevision) {
      throw Object.assign(new Error('La jornada ha canviat en una altra pestanya.'), { code: 'guardies/conflict' });
    }
    const next = {
      ...clean,
      revision: currentRevision + 1,
      clientUpdatedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    };
    transaction.set(reference, next);
    if (publicProjection !== undefined && (publicProjection || ['published', 'closed'].includes(snapshot.exists() ? snapshot.data().status : ''))) {
      writePublicGuardiesDay(transaction, cursId, date, publicProjection, next);
    }
    return { ...clean, revision: next.revision, clientUpdatedAt: next.clientUpdatedAt };
  });
}

function countedAssignmentsForDay(day) {
  const cancelled = new Set(day.cancelledAssignments || []);
  return Object.entries(day.assignments || {})
    .filter(([absenceId]) => !cancelled.has(absenceId))
    .map(([absenceId, assignment]) => {
      const [, dayFromId = '', hourFromId = ''] = String(absenceId || '').split('|');
      const raw = typeof assignment === 'string' ? { teacherId: assignment } : assignment;
      return normalizeCountedAssignment({
        ...raw,
        day: raw?.day || dayFromId,
        hour: raw?.hour || hourFromId,
      });
    })
    .filter(Boolean);
}

export async function transitionGuardiesDay(cursId, date, action, { guardHistoryEntries = [], publicProjection, expectedRevision } = {}) {
  if (!['publish', 'unpublish', 'close', 'reopen'].includes(action)) throw new Error('Acció de jornada no reconeguda.');
  const now = new Date().toISOString();
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.days ||= {};
    const day = data.days[date];
    if (!day) throw new Error('La jornada encara no existeix.');
    if (expectedRevision !== undefined && (Number(day.revision) || 0) !== expectedRevision) {
      throw Object.assign(new Error('La jornada ha canviat en una altra pestanya.'), { code: 'guardies/conflict' });
    }
    const previousCounted = day.countedAssignments || [];
    if (action === 'publish') Object.assign(day, { status: 'published', publishedAt: day.publishedAt || now, closedAt: '' });
    if (action === 'unpublish') {
      data.stats ||= { counts: {} };
      data.stats.counts = updateGuardCounts(data.stats.counts, previousCounted, []);
      data.stats.guardHistory = changeGuardHistoryDate(data.stats.guardHistory, date, [], true);
      data.stats.guardHistoryVersion = Number(data.stats.guardHistoryVersion) || 0;
      Object.assign(day, { status: 'draft', publishedAt: '', closedAt: '', countedAssignments: [] });
    }
    if (action === 'reopen') {
      data.stats ||= { counts: {} };
      data.stats.counts = updateGuardCounts(data.stats.counts, previousCounted, []);
      data.stats.guardHistory = changeGuardHistoryDate(data.stats.guardHistory, date, [], true);
      data.stats.guardHistoryVersion = Number(data.stats.guardHistoryVersion) || 0;
      Object.assign(day, { status: 'published', closedAt: '', countedAssignments: [] });
    }
    if (action === 'close') {
      const countedAssignments = countedAssignmentsForDay(day);
      data.stats ||= { counts: {} };
      data.stats.counts = updateGuardCounts(data.stats.counts, previousCounted, countedAssignments);
      data.stats.guardHistory = changeGuardHistoryDate(data.stats.guardHistory, date, guardHistoryEntries);
      data.stats.guardHistoryVersion = Number(data.stats.guardHistoryVersion) || 0;
      Object.assign(day, { status: 'closed', closedAt: now, countedAssignments });
    }
    day.clientUpdatedAt = now;
    day.revision = (Number(day.revision) || 0) + 1;
    if (publicProjection !== undefined) {
      data.publicDays ||= {};
      const next = publicProjectionForDay(publicProjection, day, cursId, date);
      if (next) data.publicDays[date] = next;
      else delete data.publicDays[date];
    }
    setE2EData(cursId, data);
    return { day, stats: data.stats || { counts: {} } };
  }

  return runTransaction(db, async (transaction) => {
    const dayReference = guardiesDayRef(cursId, date);
    const statsReference = guardiesStatsRef(cursId);
    const [daySnapshot, statsSnapshot] = await Promise.all([
      transaction.get(dayReference),
      transaction.get(statsReference),
    ]);
    if (!daySnapshot.exists()) throw new Error('La jornada encara no existeix.');
    const day = daySnapshot.data();
    if (expectedRevision !== undefined && (Number(day.revision) || 0) !== expectedRevision) {
      throw Object.assign(new Error('La jornada ha canviat en una altra pestanya.'), { code: 'guardies/conflict' });
    }
    const update = {
      revision: (Number(day.revision) || 0) + 1,
      clientUpdatedAt: now,
      updatedAt: serverTimestamp(),
    };
    let stats = statsSnapshot.exists() ? statsSnapshot.data() : { counts: {} };
    if (action === 'publish') Object.assign(update, { status: 'published', publishedAt: day.publishedAt || now, closedAt: '' });
    if (action === 'unpublish') {
      const counts = updateGuardCounts(stats.counts, day.countedAssignments || [], []);
      Object.assign(update, { status: 'draft', publishedAt: '', closedAt: '', countedAssignments: [] });
      stats = { counts, guardHistory: changeGuardHistoryDate(stats.guardHistory, date, [], true), guardHistoryVersion: Number(stats.guardHistoryVersion) || 0, updatedAt: serverTimestamp() };
      transaction.set(statsReference, stats);
    }
    if (action === 'reopen') {
      const counts = updateGuardCounts(stats.counts, day.countedAssignments || [], []);
      Object.assign(update, { status: 'published', closedAt: '', countedAssignments: [] });
      stats = { counts, guardHistory: changeGuardHistoryDate(stats.guardHistory, date, [], true), guardHistoryVersion: Number(stats.guardHistoryVersion) || 0, updatedAt: serverTimestamp() };
      transaction.set(statsReference, stats);
    }
    if (action === 'close') {
      const countedAssignments = countedAssignmentsForDay(day);
      const counts = updateGuardCounts(stats.counts, day.countedAssignments || [], countedAssignments);
      Object.assign(update, { status: 'closed', closedAt: now, countedAssignments });
      stats = { counts, guardHistory: changeGuardHistoryDate(stats.guardHistory, date, guardHistoryEntries), guardHistoryVersion: Number(stats.guardHistoryVersion) || 0, updatedAt: serverTimestamp() };
      transaction.set(statsReference, stats);
    }
    transaction.update(dayReference, update);
    if (publicProjection !== undefined) writePublicGuardiesDay(transaction, cursId, date, publicProjection, { ...day, ...update });
    return { day: { ...day, ...update }, stats };
  });
}

export async function mergeGuardiesDayPlan(cursId, date, patch) {
  const additions = Array.from(new Set(patch.absenceIds || [])).filter(Boolean);
  const groups = Array.from(new Set(patch.groupsOut || [])).filter(Boolean);
  const partialGroups = Array.from(new Set(patch.partialGroups || [])).filter(Boolean);
  const completeGroups = new Set(Array.from(new Set(patch.completeGroups || [])).filter(Boolean));
  if (E2E_AUTH_BYPASS) {
    const data = getE2EData(cursId);
    data.days ||= {};
    const current = data.days[date] || {
      schemaVersion: 1, date, status: 'draft', absenceIds: [], assignments: {}, comments: {},
      groupsOut: [], groupTeachers: {}, groupReleasedTeachers: {}, partialGroups: [], outingAbsenceIds: [], cancelledAssignments: [], publishedAt: '', closedAt: '',
      countedAssignments: [], revision: 0,
    };
    if (current.status === 'closed') return current;
    data.days[date] = {
      ...current,
      absenceIds: Array.from(new Set([...(current.absenceIds || []), ...additions])),
      groupsOut: Array.from(new Set([...(current.groupsOut || []), ...groups])),
      groupTeachers: { ...(current.groupTeachers || {}), ...(patch.groupTeachers || {}) },
      groupReleasedTeachers: { ...(current.groupReleasedTeachers || {}), ...(patch.groupReleasedTeachers || {}) },
      partialGroups: Array.from(new Set([...(current.partialGroups || []).filter((groupId) => !completeGroups.has(groupId)), ...partialGroups])),
      revision: (Number(current.revision) || 0) + 1,
      clientUpdatedAt: new Date().toISOString(),
    };
    setE2EData(cursId, data);
    return data.days[date];
  }
  return runTransaction(db, async (transaction) => {
    const reference = guardiesDayRef(cursId, date);
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? snapshot.data() : {
      schemaVersion: 1, date, status: 'draft', absenceIds: [], assignments: {}, comments: {},
      groupsOut: [], groupTeachers: {}, groupReleasedTeachers: {}, partialGroups: [], outingAbsenceIds: [], cancelledAssignments: [], publishedAt: '', closedAt: '',
      countedAssignments: [], revision: 0,
    };
    if (current.status === 'closed') return current;
    const next = {
      ...current,
      schemaVersion: 1,
      date,
      absenceIds: Array.from(new Set([...(current.absenceIds || []), ...additions])),
      groupsOut: Array.from(new Set([...(current.groupsOut || []), ...groups])),
      groupTeachers: { ...(current.groupTeachers || {}), ...(patch.groupTeachers || {}) },
      groupReleasedTeachers: { ...(current.groupReleasedTeachers || {}), ...(patch.groupReleasedTeachers || {}) },
      partialGroups: Array.from(new Set([...(current.partialGroups || []).filter((groupId) => !completeGroups.has(groupId)), ...partialGroups])),
      revision: (Number(current.revision) || 0) + 1,
      clientUpdatedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    };
    transaction.set(reference, next);
    return next;
  });
}
