import { auth } from '../firebase';

const PROJECT_ID = 'quota-e1424';
const DOCUMENTS_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function decodeValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function encodedPath(path) {
  return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function authenticatedFetch(url) {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sessió per accedir a les dades de guàrdies.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (cause) {
    const error = new Error("No s'ha pogut connectar amb Firestore.", { cause });
    error.code = 'unavailable';
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function restError(status, payload) {
  const error = new Error(payload?.error?.message || `Firestore REST ${status}`);
  error.code = status === 403 ? 'permission-denied' : status === 503 ? 'unavailable' : `http-${status}`;
  return error;
}

function documentSnapshot(document, fallbackPath = '') {
  const id = String(document?.name || fallbackPath).split('/').pop() || '';
  const data = document ? decodeFields(document.fields || {}) : undefined;
  return {
    id,
    exists: () => Boolean(document),
    data: () => data,
  };
}

export async function getRestDocument(path) {
  const response = await authenticatedFetch(`${DOCUMENTS_URL}/${encodedPath(path)}`);
  if (response.status === 404) return documentSnapshot(null, path);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw restError(response.status, payload);
  return documentSnapshot(payload, path);
}

export async function getRestCollection(path) {
  const documents = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await authenticatedFetch(`${DOCUMENTS_URL}/${encodedPath(path)}?${query}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw restError(response.status, payload);
    documents.push(...(payload.documents || []).map((document) => documentSnapshot(document)));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return { docs: documents };
}
