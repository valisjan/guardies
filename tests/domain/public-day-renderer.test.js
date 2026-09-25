import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPublicCoverage, renderPublicOutings } from '../../labs/guardies/publicDayRenderer.js';

test('public view escapes all user content and preserves coverage and observations', () => {
  const html = renderPublicCoverage({ hours: [{ label: '7a hora', observation: '<script>alert(1)</script>', rows: [{
    absent: 'Anna & Pere', group: '1ESO-A', subject: 'MAT', room: 'A14',
    assigned: 'Joan', coTeacher: true, cancelled: true, comment: '<img src=x onerror=alert(1)>',
  }] }] });
  assert.ok(html.includes('Anna &amp; Pere'));
  assert.ok(html.includes('Queda amb el grup'));
  assert.ok(html.includes('No realitzada'));
  assert.ok(html.includes('1ESO-A'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});

test('public view supports empty days, patio absences and partial outings', () => {
  assert.equal(renderPublicCoverage(null), '');
  const html = renderPublicCoverage({ hours: [{ label: '1a hora', rows: [] }, {
    kind: 'patio', label: 'Pati', patio: { zones: [{ name: 'Zona A', teacher: 'Anna', absent: true }], observation: 'Avís' },
  }] });
  assert.ok(html.includes('Sense absències'));
  assert.ok(html.includes('pati-absence-badge'));
  assert.ok(html.includes('Avís'));
  const outings = renderPublicOutings({ groupsOut: [{ id: '10', label: '1ESO-A', partial: true }] });
  assert.ok(outings.includes('data-public-outing-group="10"'));
  assert.ok(outings.includes('Sortida parcial'));
});
