import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyError } from '../../src/utils/friendlyError.js';

test('tradueix els errors de Firebase a català amb què cal fer', () => {
  assert.match(friendlyError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), /No tens permís/);
  assert.match(friendlyError({ code: 'firestore/unavailable', message: 'Failed to get document because the client is offline.' }), /No hi ha connexió/);
  assert.match(friendlyError({ code: 'auth/popup-blocked', message: 'Firebase: Error (auth/popup-blocked).' }), /finestres emergents/);
  assert.match(friendlyError(new Error('Missing or insufficient permissions.')), /No tens permís/);
  assert.match(friendlyError(new TypeError('Failed to fetch')), /No hi ha connexió/);
});

test('conserva els missatges propis i dona un genèric per a codis desconeguts', () => {
  assert.equal(friendlyError(new Error('La jornada encara no existeix.')), 'La jornada encara no existeix.');
  assert.equal(
    friendlyError(Object.assign(new Error('La jornada ha canviat en una altra pestanya.'), { code: 'guardies/conflict' })),
    'La jornada ha canviat en una altra pestanya.',
  );
  assert.equal(friendlyError({ code: 'data-loss', message: 'Unrecoverable data loss.' }), "S'ha produït un error inesperat (data-loss). Torna-ho a provar.");
  assert.equal(friendlyError('text simple'), 'text simple');
  assert.equal(friendlyError(null), 'Error desconegut.');
});
