// Accés mínim a Firestore per REST per al servei de correu: només el que necessita
// (llegir documents, la cua de pendents, marcar-ne l'estat i deixar el senyal).
import { createSign } from 'node:crypto';

export const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/quota-e1424/databases/(default)/documents';

// Token d'accés a partir de la clau d'un compte de servei (JWT signat), reutilitzat fins
// que gairebé caduca.
export function serviceAccountToken({ clientEmail, privateKey, scope = 'https://www.googleapis.com/auth/datastore' }) {
  let cached = { token: '', expires: 0 };
  return async () => {
    if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
      iss: clientEmail, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(`No s'ha pogut obtenir accés a Firestore (${response.status} ${data.error || ''}).`);
    cached = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    return cached.token;
  };
}

function decode(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  }
  return null;
}

const decodeFields = (fields) => decode({ mapValue: { fields: fields || {} } });

export function firestoreRest({ base = FIRESTORE_BASE, token }) {
  async function request(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw Object.assign(new Error(`Firestore ${response.status}: ${text.slice(0, 300)}`), { status: response.status, body: text });
    return text ? JSON.parse(text) : {};
  }

  return {
    async read(path) {
      const document = await request('GET', `${base}/${path}`);
      return document ? decodeFields(document.fields) : null;
    },

    async pendingMails() {
      const rows = await request('POST', `${base}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: 'guardiesCorreus' }],
          where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pendent' } } },
          limit: 200,
        },
      }) || [];
      return rows.filter((row) => row.document).map((row) => ({
        ...decodeFields(row.document.fields),
        id: row.document.name.split('/').pop(),
        documentName: row.document.name,
        updateTime: row.document.updateTime,
      }));
    },

    // Canvia l'estat només si el correu no ha canviat des que s'ha llegit (precondició
    // dins del cos d'un commit). Retorna false si ha canviat.
    async setStatus(mail, status, reason = '', now = new Date()) {
      const fields = { status: { stringValue: status }, reason: { stringValue: reason } };
      if (status === 'enviat') fields.sentAt = { timestampValue: now.toISOString() };
      try {
        const result = await request('POST', `${base}:commit`, {
          writes: [{
            update: { name: mail.documentName, fields },
            updateMask: { fieldPaths: Object.keys(fields) },
            currentDocument: { updateTime: mail.updateTime },
          }],
        });
        mail.updateTime = result.writeResults[0].updateTime;
        return true;
      } catch (error) {
        if (/FAILED_PRECONDITION/.test(error.body || error.message)) return false;
        throw error;
      }
    },

    // Senyal perquè Guàrdies mostri que el servei funciona i des de quin compte envia.
    async heartbeat(now, account) {
      await request('PATCH', `${base}/config/guardies-correus?updateMask.fieldPaths=lastRunAt&updateMask.fieldPaths=account`, {
        fields: { lastRunAt: { timestampValue: now.toISOString() }, account: { stringValue: account || '' } },
      });
    },
  };
}
