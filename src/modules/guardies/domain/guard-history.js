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

// Franja d'una assignació, calculada com als recomptes: la clau de l'absència
// és "professor|dia|hora|…" i el dia/hora explícits tenen prioritat.
export function guardSlotFromAssignment(absenceId, assignment = {}) {
  const [, dayFromId = '', hourFromId = ''] = String(absenceId || '').split('|');
  return String(assignment?.slot || guardSlotKey(assignment?.day || dayFromId, assignment?.hour || hourFromId) || '').trim();
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
