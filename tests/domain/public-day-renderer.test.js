import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPublicHourKey, renderPublicCoverage, renderPublicOutings } from '../../labs/guardies/publicDayRenderer.js';

test('public view escapes all user content and preserves coverage and observations', () => {
  const html = renderPublicCoverage({ hours: [{ label: '7a hora', observation: '<script>alert(1)</script>', rows: [{
    absent: 'Anna & Pere', group: '1ESO-A', subject: 'MAT', room: 'A14',
    assigned: 'Joan', coTeacher: true, comment: '<img src=x onerror=alert(1)>',
  }, {
    absent: 'Marta', group: '1ESO-B', subject: 'MAT', room: 'A15', assigned: 'Pere', source: 'guard', cancelled: true,
  }] }] });
  assert.ok(html.includes('Anna &amp; Pere'));
  assert.ok(html.includes('Queda amb el grup'));
  assert.ok(html.includes('No realitzada'));
  assert.ok(html.includes('1ESO-A'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});

test('public view shows that a flexible split returns to its group without a substitute', () => {
  const html = renderPublicCoverage({ hours: [{ label: '4a hora', rows: [{
    absent: 'MILL', group: '1ESO-E + 1ESO-F', subject: 'MAT-EF-1E', room: 'Sala B', assigned: '', returnsToGroup: true,
  }] }] });
  assert.ok(html.includes('Sense substitució'));
  assert.ok(html.includes('Torna al seu grup'));
  assert.ok(!html.includes('Sense assignar'));
  assert.ok(!html.includes('pending'));
});

test('public view labels every row status and only draws comments that exist', () => {
  const row = (fields) => ({ absent: 'A', group: '1ESO-A', subject: 'MAT', room: 'A14', assigned: '', ...fields });
  const html = renderPublicCoverage({ hours: [{ label: '1a hora', rows: [
    row({}),
    row({ assigned: 'Pere', source: 'guard' }),
    row({ group: 'Guàrdia', subject: 'Guàrdia', room: '' }),
    row({ returnsToGroup: true }),
  ] }] });
  assert.deepEqual([...html.matchAll(/public-row status-([a-z-]+)/g)].map((match) => match[1]), ['open', 'covered', 'info', 'returns']);
  assert.match(html, /status-label">Sense cobrir<\/span><strong class="readonly-assignment pending">Pendent/);
  assert.match(html, /status-label">Guàrdia<\/span><strong class="readonly-assignment assigned">Pere/);
  assert.match(html, /status-label">No cal cobrir-la<\/span><strong class="readonly-assignment ">Sense substitució/);
  assert.match(html, /<span class="coverage-detail-line">MAT · A14<\/span>/);
  assert.equal(html.includes('coverage-comment-cell'), false);
});

test('public view names the role like Pantalles, without a separate G mark', () => {
  const html = renderPublicCoverage({ hours: [{ label: '2a hora', rows: [
    { absent: 'A', group: '1ESO-A', assigned: 'Pere Blanes', source: 'guard' },
    { absent: 'B', group: '1ESO-B', assigned: 'Joana Mas', source: 'released' },
    { absent: 'C', group: '1ESO-C', assigned: 'Llucia Pons', source: 'co-teacher', coTeacher: true },
  ] }] });
  assert.match(html, /status-label">Guàrdia<\/span><strong class="readonly-assignment assigned">Pere Blanes<\/strong>/);
  assert.match(html, /status-label">Alliberat\/ada<\/span><strong class="readonly-assignment assigned">Joana Mas<\/strong>/);
  assert.match(html, /status-label">Queda amb el grup<\/span><strong class="readonly-assignment assigned">Llucia Pons<\/strong>/);
  assert.equal(html.includes('guard-source-mark'), false);
});

test('finds the current hour from the published keys, including the patio', () => {
  const hours = ['8:00', '8:55', '9:50', 'PATI', '11:15', '12:10', '13:05', '14:15'].map((key) => ({ key, kind: key === 'PATI' ? 'patio' : 'guardies' }));
  const at = (time, date = '2026-10-22') => new Date(`${date}T${time}:00`);
  assert.equal(currentPublicHourKey(hours, at('08:30')), '8:00');
  assert.equal(currentPublicHourKey(hours, at('10:44')), '9:50');
  assert.equal(currentPublicHourKey(hours, at('10:50')), 'PATI');
  assert.equal(currentPublicHourKey(hours, at('11:15')), '11:15');
  assert.equal(currentPublicHourKey(hours, at('15:00')), '14:15');
  assert.equal(currentPublicHourKey(hours, at('15:10')), '');
  assert.equal(currentPublicHourKey(hours, at('07:59')), '');
  assert.equal(currentPublicHourKey(hours, at('09:00', '2026-10-24')), '');
  assert.equal(currentPublicHourKey(hours, null), '');
});

test('public view highlights the current hour, counts pending guards and keeps empty hours discreet', () => {
  const day = { hours: [
    { key: '8:00', label: '1a hora · 8:00', rows: [{ absent: 'A', group: '1ESO-A', assigned: '' }, { absent: 'B', group: '1ESO-B', assigned: 'Pere' }] },
    { key: '8:55', label: '2a hora · 8:55', rows: [] },
    { key: 'PATI', kind: 'patio', label: 'Pati · 10:45–11:15', patio: { zones: [] } },
  ] };
  const html = renderPublicCoverage(day, { now: new Date('2026-10-22T08:30:00') });
  assert.match(html, /class="coverage-session has-open is-current" data-public-hour="8:00"/);
  assert.match(html, /<h3>1a hora · 8:00<\/h3><strong class="now-badge">Ara<\/strong><em class="session-pending">1 sense cobrir<\/em><span>2 absències<\/span>/);
  assert.match(html, /class="coverage-session is-empty" data-public-hour="8:55"/);
  // Un pati sense zones ni observacions no deixa cap capsa buida.
  assert.equal(html.includes('pati-session'), false);
  // Si no es mira avui, no hi ha hora en curs.
  assert.equal(renderPublicCoverage(day).includes('is-current'), false);
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
  assert.equal(renderPublicOutings({ groupsOut: [] }), '');
});
