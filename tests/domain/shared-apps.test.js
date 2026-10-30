import test from 'node:test';
import assert from 'node:assert/strict';
import { centreApps } from '../../src/shared/apps.ts';

const keys = (access) => centreApps(access, 'guardies.iessureda.com').map((app) => app.key);

test('el menú d\'aplicacions depèn de la sessió i del rol', () => {
  assert.deepEqual(keys({ signedIn: false, isAdmin: true }), []);
  assert.deepEqual(keys({ signedIn: true }), ['quota', 'guardies']);
  assert.deepEqual(keys({ signedIn: true, canRetards: true }), ['quota', 'guardies', 'retards']);
  assert.deepEqual(keys({ signedIn: true, isAdmin: true }), ['quota', 'guardies', 'pantalles', 'retards']);
});

test('el professorat va a la seva vista de Guàrdies i es conserva el curs', () => {
  const guardies = (access) => centreApps({ signedIn: true, ...access }, 'quota.iessureda.com').find((app) => app.key === 'guardies').href;
  assert.equal(guardies({ courseId: '2026-2027' }), 'https://guardies.iessureda.com/?curs=2026-2027&vista=professor');
  assert.equal(guardies({ isAdmin: true }), 'https://guardies.iessureda.com/');
});

test('des d\'una adreça de Netlify, els enllaços es queden a Netlify', () => {
  const apps = centreApps({ signedIn: true, isAdmin: true }, 'guardies.netlify.app');
  assert.ok(apps.every((app) => app.href.includes('.netlify.app')));
});
