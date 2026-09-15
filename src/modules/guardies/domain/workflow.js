import { localDateString, xmlDayForDate } from './day.js';

export function teachingDatesBetween(from, to) {
  const start = new Date(`${from || ''}T12:00:00`);
  const end = new Date(`${to || ''}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const dates = [];
  for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    const value = localDateString(current);
    if (['1', '2', '3', '4', '5'].includes(xmlDayForDate(value))) dates.push(value);
  }
  return dates;
}

export function candidateRank(candidate) {
  if (candidate.unavailable) return 3;
  if (candidate.convivencia) return 2;
  if (candidate.released) return 0;
  return 1;
}

export function guardSlotKey(day, hour) {
  const cleanDay = String(day || '').trim();
  const cleanHour = String(hour || '').trim();
  return cleanDay && cleanHour ? `${cleanDay}|${cleanHour}` : '';
}

function normalizeGuardSlots(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([slot, count]) => [String(slot || '').trim(), Math.max(0, Math.trunc(Number(count) || 0))])
    .filter(([slot, count]) => slot && count > 0));
}

export function normalizeGuardCount(value) {
  if (value && typeof value === 'object') {
    const released = Math.max(0, Number(value.released) || 0);
    const guardSlots = normalizeGuardSlots(value.guardSlots);
    const slottedGuard = Object.values(guardSlots).reduce((sum, count) => sum + count, 0);
    const declaredGuard = Math.max(0, Number(value.guard) || 0);
    const guardLegacy = Object.prototype.hasOwnProperty.call(value, 'guardLegacy')
      ? Math.max(0, Number(value.guardLegacy) || 0)
      : Math.max(0, declaredGuard - slottedGuard);
    const guard = guardLegacy + slottedGuard;
    const other = Math.max(0, Number(value.other) || 0);
    return {
      total: released + guard + other,
      released,
      guard,
      other,
      guardLegacy,
      guardSlots,
    };
  }
  const total = Math.max(0, Number(value) || 0);
  return { total, released: 0, guard: 0, other: total, guardLegacy: 0, guardSlots: {} };
}

export function guardCountForSlot(value, day, hour) {
  const slot = hour === undefined ? String(day || '') : guardSlotKey(day, hour);
  return normalizeGuardCount(value).guardSlots[slot] || 0;
}

export function normalizeCountedAssignment(value) {
  const teacherId = typeof value === 'string' ? value : value?.teacherId;
  if (!teacherId) return null;
  if (value?.source === 'co-teacher') return null;
  const source = ['released', 'guard'].includes(value?.source) ? value.source : 'other';
  const slot = source === 'guard'
    ? String(value?.slot || guardSlotKey(value?.day, value?.hour) || '').trim()
    : '';
  return { teacherId, source, ...(slot ? { slot } : {}) };
}

function frequencyBySource(values) {
  return values.reduce((result, raw) => {
    const value = normalizeCountedAssignment(raw);
    if (!value) return result;
    result[value.teacherId] ||= {
      total: 0, released: 0, guard: 0, other: 0, guardLegacy: 0, guardSlots: {},
    };
    result[value.teacherId].total += 1;
    result[value.teacherId][value.source] += 1;
    if (value.source === 'guard') {
      if (value.slot) {
        result[value.teacherId].guardSlots[value.slot] = (result[value.teacherId].guardSlots[value.slot] || 0) + 1;
      } else {
        result[value.teacherId].guardLegacy += 1;
      }
    }
    return result;
  }, {});
}

export function updateGuardCounts(currentCounts, previousAssignments, nextAssignments) {
  const previous = frequencyBySource(previousAssignments);
  const next = frequencyBySource(nextAssignments);
  const counts = { ...(currentCounts || {}) };
  new Set([...Object.keys(previous), ...Object.keys(next)]).forEach((teacherId) => {
    const current = normalizeGuardCount(counts[teacherId]);
    const before = previous[teacherId] || {
      total: 0, released: 0, guard: 0, other: 0, guardLegacy: 0, guardSlots: {},
    };
    const after = next[teacherId] || {
      total: 0, released: 0, guard: 0, other: 0, guardLegacy: 0, guardSlots: {},
    };
    const guardSlots = { ...current.guardSlots };
    new Set([...Object.keys(before.guardSlots), ...Object.keys(after.guardSlots)]).forEach((slot) => {
      const count = Math.max(0, (guardSlots[slot] || 0) - (before.guardSlots[slot] || 0) + (after.guardSlots[slot] || 0));
      if (count) guardSlots[slot] = count;
      else delete guardSlots[slot];
    });
    const released = Math.max(0, current.released + after.released - before.released);
    const other = Math.max(0, current.other + after.other - before.other);
    const guardLegacy = Math.max(0, current.guardLegacy + after.guardLegacy - before.guardLegacy);
    const guard = guardLegacy + Object.values(guardSlots).reduce((sum, count) => sum + count, 0);
    counts[teacherId] = {
      total: released + guard + other,
      released,
      guard,
      other,
      guardLegacy,
      guardSlots,
    };
  });
  return counts;
}

export function sortCoverageCandidates(candidates, guardCounts = new Map(), label = (candidate) => candidate.teacherId, slot = {}) {
  return [...candidates].sort((a, b) => {
    const rank = candidateRank(a) - candidateRank(b);
    if (rank) return rank;
    const countFor = (candidate) => candidate.released
      ? normalizeGuardCount(guardCounts.get(candidate.teacherId)).released
      : guardCountForSlot(guardCounts.get(candidate.teacherId), slot.day, slot.hour);
    const count = countFor(a) - countFor(b);
    if (count) return count;
    return String(label(a) || '').localeCompare(String(label(b) || ''), 'ca', { numeric: true });
  });
}

export function guardCountDelta(previousAssignments = [], nextAssignments = []) {
  const result = new Map();
  previousAssignments.forEach((teacherId) => result.set(teacherId, (result.get(teacherId) || 0) - 1));
  nextAssignments.forEach((teacherId) => result.set(teacherId, (result.get(teacherId) || 0) + 1));
  return new Map(Array.from(result).filter(([, delta]) => delta !== 0));
}
