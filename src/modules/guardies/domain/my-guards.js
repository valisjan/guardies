// «Les meves guàrdies»: tot el que afecta qui ha entrat, a partir de dades que el
// professorat ja pot llegir (fulls publicats, horari, recomptes i historial).
import { isSamePerson } from './names.js';
import { minutesFromHour } from './day.js';

const PATI_START = '10:45';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Nom d'una opció de professorat sense el codi curt («Nom · CODI»).
function teacherNames(teacher) {
  const label = String(teacher?.label || '');
  return [teacher?.name, label.split(' · ')[0], label].filter(Boolean);
}

// El professor de l'horari que és qui ha entrat (pel nom del compte de Google).
export function viewerTeacher(options, viewerName) {
  return (options || []).find((teacher) => teacherNames(teacher).some((name) => isSamePerson(viewerName, name))) || null;
}

// Guàrdies que em toquen als fulls publicats: cobertures assignades i zona de pati.
export function myPublishedGuards(days, viewerName) {
  const guards = [];
  (days || []).forEach((day) => (day?.hours || []).forEach((hour) => {
    if (hour.kind === 'patio') {
      (hour.patio?.zones || []).forEach((zone) => {
        if (!isSamePerson(viewerName, zone.teacher)) return;
        guards.push({ date: day.date, hour: hour.label, kind: 'patio', zone: zone.name, absent: Boolean(zone.absent) });
      });
      return;
    }
    (hour.rows || []).forEach((row) => {
      if (row.cancelled || !row.assigned || !isSamePerson(viewerName, row.assigned)) return;
      guards.push({
        date: day.date,
        hour: hour.label,
        kind: 'guard',
        absent: row.absent || '',
        group: row.group || '',
        subject: row.subject || '',
        room: row.room || '',
        comment: row.comment || '',
      });
    });
  }));
  return guards;
}

// Historial (professor -> data -> { "dia|hora": [grups] }) de tots els àlies d'un professor,
// de la guàrdia més recent a la més antiga. Les dades antigues sense franja surten sense hora.
export function teacherHistoryEntries(guardHistory, aliases) {
  const keys = new Set((aliases || []).map(normalize).filter(Boolean));
  const entries = new Map();
  Object.entries(guardHistory || {}).forEach(([teacherId, dates]) => {
    if (!keys.has(normalize(teacherId)) || !dates || typeof dates !== 'object') return;
    Object.entries(dates).forEach(([date, bySlot]) => {
      const slots = Array.isArray(bySlot) ? { '': bySlot } : (bySlot && typeof bySlot === 'object' ? bySlot : {});
      Object.entries(slots).forEach(([slot, groups]) => {
        const key = `${date}|${slot}`;
        const merged = new Set([...(entries.get(key)?.groups || []), ...(Array.isArray(groups) ? groups : [])]);
        entries.set(key, { date, slot, groups: Array.from(merged).sort((x, y) => x.localeCompare(y, 'ca', { numeric: true })) });
      });
    });
  });
  return Array.from(entries.values())
    .sort((a, b) => b.date.localeCompare(a.date) || b.slot.localeCompare(a.slot, 'ca', { numeric: true }));
}

function hourMinutes(hour) {
  return minutesFromHour(hour === 'PATI' ? PATI_START : hour);
}

export function compareHours(a, b) {
  const left = hourMinutes(a);
  const right = hourMinutes(b);
  if (left !== null && right !== null) return left - right;
  return String(a).localeCompare(String(b), 'ca', { numeric: true });
}

// Horari setmanal d'un professor: files per hora (totes les del centre, en ordre) i
// columnes de dilluns a divendres, amb les seves sessions a cada casella.
export function weeklyTimetable(sessions, teacherId, isGuardSession = () => false) {
  const school = (sessions || []).filter((session) => session.dia >= '1' && session.dia <= '5' && session.hora);
  const mine = school.filter((session) => session.placa === teacherId);
  const hours = Array.from(new Set(school.map((session) => session.hora))).sort(compareHours);
  const days = ['1', '2', '3', '4', '5'];
  const rows = hours.map((hour) => ({
    hour,
    label: hour === 'PATI' ? PATI_START : hour,
    cells: days.map((day) => {
      const items = mine.filter((session) => session.dia === day && session.hora === hour);
      const kinds = new Set(items.map((session) => {
        if (session.hora === 'PATI') return 'patio';
        if (isGuardSession(session)) return 'guard';
        return session.teClasse ? 'class' : 'activity';
      }));
      return { day, items, kinds };
    }),
  }));
  // Les hores en què no té res cap dia no aporten res a l'horari personal.
  return rows.filter((row) => row.cells.some((cell) => cell.items.length));
}
