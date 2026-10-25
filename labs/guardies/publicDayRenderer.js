import { isSamePerson } from '../../src/modules/guardies/domain/names.js';

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

const MINE_CHIP = '<span class="mine-chip">Tu</span>';

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

// Qui es fa càrrec, com a Pantalles: l'etiqueta ja diu si és de guàrdia o alliberat.
function statusLabel(row, status) {
  if (status === 'covered' && row.source === 'guard') return 'Guàrdia';
  if (status === 'covered' && row.source === 'released') return 'Alliberat/ada';
  return STATUS_LABELS[status];
}

const PATI_START = 10 * 60 + 45;
const PATI_END = 11 * 60 + 15;
const LAST_HOUR_MINUTES = 55;

function isPatio(hour) {
  return hour?.kind === 'patio' || hour?.key === 'PATI';
}

function keyMinutes(key) {
  const match = String(key || '').match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Hora en curs de la jornada publicada (clau) o '': cada hora va de la seva clau fins
// que comença la següent, el pati de 10:45 a 11:15 i la darrera dura 55 minuts.
export function currentPublicHourKey(hours, now) {
  if (!now || now.getDay() === 0 || now.getDay() === 6) return '';
  const list = Array.isArray(hours) ? hours : [];
  const minutes = now.getHours() * 60 + now.getMinutes();
  const starts = list.map((hour) => (isPatio(hour) ? PATI_START : keyMinutes(hour.key)));
  const index = list.findIndex((hour, position) => {
    const start = starts[position];
    if (start === null) return false;
    const next = starts.slice(position + 1).find((value) => value !== null && value > start);
    const end = isPatio(hour) ? PATI_END : (next ?? start + LAST_HOUR_MINUTES);
    return minutes >= start && minutes < end;
  });
  return index >= 0 ? String(list[index].key) : '';
}

function rowDetail(row) {
  return [row.subject !== row.group ? row.subject : '', row.room].filter(Boolean).join(' · ');
}

function renderRow(row, mine) {
  const status = publicRowStatus(row);
  const cover = row.assignedDisplay || row.assigned || (status === 'open' ? 'Pendent' : 'Sense substitució');
  const detail = rowDetail(row);
  return `
      <article class="coverage-item coverage-row public-row status-${status} ${row.cancelled ? 'not-completed' : ''} ${mine ? 'is-mine' : ''}">
        <div class="coverage-professor-cell"><span class="cell-kicker">Absència</span><strong class="no-print">${escape(row.absentDisplay || row.absent)}</strong><strong class="print-only">${escape(row.absent)}</strong></div>
        <div class="coverage-detail-cell"><strong class="coverage-group-label">${escape(row.group)}</strong>${detail ? `<span class="coverage-detail-line">${escape(detail)}</span>` : ''}</div>
        <div class="coverage-assignment-cell"><span class="cell-kicker status-label">${statusLabel(row, status)}</span><strong class="readonly-assignment ${row.assigned ? 'assigned' : status === 'open' ? 'pending' : ''}">${escape(cover)}${mine ? ` ${MINE_CHIP}` : ''}</strong></div>
        ${row.comment ? `<div class="coverage-comment-cell">${escape(row.comment)}</div>` : ''}
      </article>`;
}

// Àncora de cada hora, per saltar-hi des del resum.
export function publicHourAnchor(key) {
  return `hora-${String(key || '').replace(/[^a-zA-Z0-9]/g, '')}`;
}

// El que li toca fer a qui mira la jornada: les files que cobreix (excepte les no
// realitzades) i la seva zona de pati. Només surt si el nom coincideix, perquè no
// digui mai que no hi ha res quan el nom del compte no s'ha pogut reconèixer.
function renderMyGuards(hours, isMine, today) {
  const items = hours.flatMap((hour) => {
    if (isPatio(hour)) {
      return (hour.patio?.zones || []).filter((zone) => isMine(zone.teacher)).map((zone) => ({
        key: hour.key, hour: hour.label, detail: zone.name, role: '',
      }));
    }
    return (hour.rows || []).filter((row) => !row.cancelled && isMine(row.assigned)).map((row) => {
      const status = publicRowStatus(row);
      return {
        key: hour.key,
        hour: hour.label,
        detail: [row.group, row.room].filter(Boolean).join(' · '),
        role: status === 'coteacher' || row.source === 'released' ? statusLabel(row, status) : '',
      };
    });
  });
  if (!items.length) return '';
  return `<section class="my-guards" aria-label="Les teves guàrdies">
      <strong class="my-guards-title">${today ? 'Avui et toca' : 'Aquest dia et toca'}</strong>
      <div class="my-guards-list">${items.map((item) => `
        <a class="my-guard" href="#${publicHourAnchor(item.key)}" data-public-jump="${escape(item.key)}"><strong>${escape(item.hour)}</strong>${item.detail ? `<span>${escape(item.detail)}</span>` : ''}${item.role ? `<em>${escape(item.role)}</em>` : ''}</a>`).join('')}
      </div>
    </section>`;
}

// Jornada publicada per al professorat. Amb `now` (només si es mira avui) es destaca
// l'hora en curs; les hores sense absències són discretes i el pati buit no surt.
// Amb `viewer` (el nom del compte) es marquen les guàrdies pròpies i se'n fa un resum.
export function renderPublicCoverage(day, { now = null, viewer = '' } = {}) {
  const hours = day?.hours || [];
  const current = currentPublicHourKey(hours, now);
  const isMine = (label) => Boolean(viewer && label) && isSamePerson(viewer, label);
  return renderMyGuards(hours, isMine, Boolean(now)) + hours.map((hour) => {
    const patio = isPatio(hour);
    const zones = hour.patio?.zones || [];
    const patioObservation = hour.patio?.observation || '';
    if (patio && !zones.length && !patioObservation && !hour.observation) return '';
    const rows = patio ? [] : (hour.rows || []);
    const open = rows.filter((row) => publicRowStatus(row) === 'open').length;
    const isCurrent = Boolean(current) && String(hour.key) === current;
    const progress = patio ? '' : !rows.length ? (hour.observation ? '' : 'is-empty') : open ? 'has-open' : 'is-covered';
    const count = rows.length ? `${rows.length} ${rows.length === 1 ? 'absència' : 'absències'}` : 'Sense absències';
    const classes = ['coverage-session', patio && 'pati-session', progress, isCurrent && 'is-current'].filter(Boolean).join(' ');
    const zoneCards = zones.map((zone) => {
      const mine = isMine(zone.teacher);
      return `
      <article class="pati-zone-card ${zone.absent ? 'absent' : ''} ${mine ? 'is-mine' : ''}"><strong class="pati-zone-name">${escape(zone.name)}</strong><span class="pati-teacher-name">${escape(zone.teacher)}${mine ? ` ${MINE_CHIP}` : ''}</span>${zone.absent ? '<small class="pati-absence-badge">Absent</small>' : ''}</article>`;
    }).join('');
    return `<section class="${classes}" id="${publicHourAnchor(hour.key)}" data-public-hour="${escape(hour.key)}">
      <header class="coverage-session-head"><h3>${escape(hour.label)}</h3>${isCurrent ? '<strong class="now-badge">Ara</strong>' : ''}${open ? `<em class="session-pending">${open} sense cobrir</em>` : ''}${patio ? '' : `<span>${count}</span>`}</header>
      ${patio ? `${zones.length ? `<div class="pati-zone-grid">${zoneCards}</div>` : ''}${patioObservation ? `<p>${escape(patioObservation)}</p>` : ''}` : rows.map((row) => renderRow(row, isMine(row.assigned))).join('')}
      ${hour.observation ? `<p class="seventh-observation-readonly">${escape(hour.observation)}</p>` : ''}
    </section>`;
  }).join('');
}

// Sense grups de sortida no es mostra res: el panell s'amaga.
export function renderPublicOutings(day) {
  return (day?.groupsOut || []).map((group) => `
    <article class="teacher-outing-group" data-public-outing-group="${escape(group.id)}"><strong>${escape(group.label)}</strong><span>${group.partial ? 'Sortida parcial' : 'Fora del centre'}</span></article>`).join('');
}
