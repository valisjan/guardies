function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function renderPublicCoverage(day) {
  return (day?.hours || []).map((hour) => {
    const patio = hour.kind === 'patio';
    const rows = (hour.rows || []).map((row) => `
      <article class="coverage-item coverage-row ${row.assigned ? 'covered' : ''} ${row.cancelled ? 'not-completed' : ''}">
        <div class="coverage-professor-cell"><span class="cell-kicker">Absència</span><strong class="no-print">${escape(row.absentDisplay || row.absent)}</strong><strong class="print-only">${escape(row.absent)}</strong></div>
        <div class="coverage-detail-cell"><strong class="coverage-group-label">${escape(row.group)}</strong><span>${escape(row.subject)}</span><strong class="coverage-room-label">${escape(row.room)}</strong></div>
        <div class="coverage-assignment-cell"><strong class="readonly-assignment ${row.assigned ? 'assigned' : 'pending'}">${escape(row.assignedDisplay || row.assigned || (row.group === 'Guàrdia' ? 'Sense substitució' : 'Sense assignar'))}</strong>${row.coTeacher ? '<span class="co-teacher-badge">Queda amb el grup</span>' : ''}${row.cancelled ? '<span>No realitzada</span>' : ''}</div>
        <div class="coverage-comment-cell">${escape(row.comment)}</div>
      </article>`).join('');
    const zones = (hour.patio?.zones || []).map((zone) => `
      <article class="pati-zone-card ${zone.absent ? 'absent' : ''}"><strong class="pati-zone-name">${escape(zone.name)}</strong><span class="pati-teacher-name">${escape(zone.teacher)}</span>${zone.absent ? '<small class="pati-absence-badge">Absent</small>' : ''}</article>`).join('');
    return `<section class="coverage-session ${patio ? 'pati-session' : ''}">
      <header class="coverage-session-head"><h3>${escape(hour.label)}</h3></header>
      ${patio ? `<div class="pati-zone-grid">${zones}</div><p>${escape(hour.patio?.observation)}</p>` : rows || '<div class="coverage-empty">Sense absències</div>'}
      ${hour.observation ? `<p class="seventh-observation-readonly">${escape(hour.observation)}</p>` : ''}
    </section>`;
  }).join('');
}

export function renderPublicOutings(day) {
  return (day?.groupsOut || []).map((group) => `
    <article class="teacher-outing-group" data-public-outing-group="${escape(group.id)}"><strong>${escape(group.label)}</strong><span>${group.partial ? 'Sortida parcial' : 'Fora del centre'}</span></article>`).join('') || '<div class="empty-small">—</div>';
}
