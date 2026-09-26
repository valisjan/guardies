import { guardSlotKey } from './workflow.js';

// Versió 1 desava només grups per data; la 2 els desa per franja (dia|hora),
// igual que els recomptes, i permet mostrar només les guàrdies d'una franja.
export const GUARD_HISTORY_VERSION = 2;

// Grups que es guarden a l'historial de guàrdies d'un professor. Segueix la
// mateixa regla que la pantalla de cobertura: grups visibles i, només si no n'hi
// ha, els cursos visibles. Els identificadors interns d'Untis no s'hi inclouen.
export function guardHistoryGroups(item) {
  const groups = item?.grupsVisibles?.length ? item.grupsVisibles : (item?.cursosVisibles || []);
  return Array.from(new Set(groups.map((group) => String(group || '').trim()).filter(Boolean)));
}

// Neteja els grups ja desats abans d'aquesta regla: descarta identificadors
// numèrics interns i el curs sol quan hi ha un grup d'aquest curs (3ESO-E).
export function displayHistoryGroups(groups) {
  const clean = Array.from(new Set((Array.isArray(groups) ? groups : [])
    .map((group) => String(group || '').trim())
    .filter((group) => group && !/^\d+$/.test(group))));
  return clean.filter((group) => !clean.some((other) => other !== group && other.startsWith(`${group}-`)));
}

// Franja d'una assignació, calculada com als recomptes: la clau de l'absència
// és "professor|dia|hora|…" i el dia/hora explícits tenen prioritat.
export function guardSlotFromAssignment(absenceId, assignment = {}) {
  const [, dayFromId = '', hourFromId = ''] = String(absenceId || '').split('|');
  return String(assignment?.slot || guardSlotKey(assignment?.day || dayFromId, assignment?.hour || hourFromId) || '').trim();
}

// Reconstrueix l'historial (v2) a partir de les jornades tancades.
// days: [[data, jornada], …]; absenceDetails: { idAbsència: { groups } }.
export function guardHistoryFromClosedDays(days, absenceDetails = {}) {
  const history = {};
  days.forEach(([date, day]) => {
    if (day?.status !== 'closed') return;
    const cancelled = new Set(day.cancelledAssignments || []);
    Object.entries(day.assignments || {}).forEach(([absenceId, assignment]) => {
      const raw = typeof assignment === 'string' ? { teacherId: assignment } : assignment;
      if (raw?.source !== 'guard' || !raw.teacherId || cancelled.has(absenceId)) return;
      const slot = guardSlotFromAssignment(absenceId, raw);
      if (!slot) return;
      history[raw.teacherId] ||= {};
      history[raw.teacherId][date] ||= {};
      const bySlot = history[raw.teacherId][date];
      bySlot[slot] = Array.from(new Set([...(bySlot[slot] || []), ...(absenceDetails[absenceId]?.groups || [])]));
    });
  });
  return history;
}

// Guàrdies d'una franja concreta: [{ date, groups }] de la més recent a la més
// antiga. Les dades v1 (sense franja) no es poden situar i s'ignoren.
export function slotHistoryEntries(dates, slot) {
  if (!dates || typeof dates !== 'object' || !slot) return [];
  return Object.entries(dates)
    .filter(([, bySlot]) => bySlot && typeof bySlot === 'object' && !Array.isArray(bySlot) && Array.isArray(bySlot[slot]))
    .map(([date, bySlot]) => ({ date, groups: bySlot[slot] }))
    .sort((left, right) => right.date.localeCompare(left.date));
}
