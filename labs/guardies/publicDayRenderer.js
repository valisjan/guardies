function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

// Marca qui fa la guàrdia: professorat de guàrdia (G) o alliberat per una sortida.
function sourceMark(row) {
  if (!row.assigned || row.coTeacher) return '';
  if (row.source === 'guard') return ' <abbr class="guard-source-mark is-guard" title="Professorat de guàrdia">G</abbr>';
  if (row.source === 'released') return ' <span class="guard-source-mark is-released">Alliberat/ada</span>';
  return '';
}

// Estat de cada fila, amb els mateixos criteris que el full de guàrdies i Pantalles.
export function publicRowStatus(row) {
  if (row?.group === 'Guàrdia') return 'info';
  if (row?.assigned) {
    if (row.cancelled) return 'not-done';
    return row.coTeacher ? 'coteacher' : 'covered';
  }
  return row?.returnsToGroup ? 'returns' : 'open';
}

const STATUS_LABELS = {
  open: 'Sense cobrir',
  covered: 'Cobreix',
  coteacher: 'Queda amb el grup',
  returns: 'Torna al seu grup',
  'not-done': 'No realitzada',
  info: 'No cal cobrir-la',
};

function renderRow(row) {
  const status = publicRowStatus(row);
  const cover = row.assignedDisplay || row.assigned || (status === 'open' ? 'Pendent' : 'Sense substitució');
  const detail = [row.subject !== row.group ? row.subject : '', row.room].filter(Boolean).join(' · ');
  return `
      <article class="coverage-item coverage-row public-row status-${status} ${row.cancelled ? 'not-completed' : ''}">
        <div class="coverage-professor-cell"><span class="cell-kicker">Absència</span><strong class="no-print">${escape(row.absentDisplay || row.absent)}</strong><strong class="print-only">${escape(row.absent)}</strong></div>
        <div class="coverage-detail-cell"><strong class="coverage-group-label">${escape(row.group)}</strong>${detail ? `<span class="coverage-detail-line">${escape(detail)}</span>` : ''}</div>
        <div class="coverage-assignment-cell"><span class="cell-kicker status-label">${STATUS_LABELS[status]}</span><strong class="readonly-assignment ${row.assigned ? 'assigned' : status === 'open' ? 'pending' : ''}">${escape(cover)}${sourceMark(row)}</strong></div>
        ${row.comment ? `<div class="coverage-comment-cell">${escape(row.comment)}</div>` : ''}
      </article>`;
}

export function renderPublicCoverage(day) {
  return (day?.hours || []).map((hour) => {
    const patio = hour.kind === 'patio';
    const rows = (hour.rows || []).map(renderRow).join('');
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
