import { normalizePatioConfig, WEEKDAYS } from './patio.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function conflict() {
  return Object.assign(
    new Error('La configuració del pati ha canviat en una altra sessió. Revisa els canvis abans de tornar a desar.'),
    { code: 'guardies/conflict' },
  );
}

function mergeField(base, desired, current) {
  if (same(base, desired)) return current;
  if (!same(base, current) && !same(desired, current)) throw conflict();
  return desired;
}

function withoutOverrides(teachers) {
  return teachers.map(({ teacherId, startZoneId }) => ({ teacherId, startZoneId }));
}

// Apply only what the settings panel changed. Daily zone overrides are edited
// elsewhere, so a pending settings save must preserve their latest values.
export function mergePatioConfiguration(baseValue, desiredValue, currentValue) {
  const base = normalizePatioConfig(baseValue, { startYear: baseValue?.startYear });
  const desired = normalizePatioConfig(desiredValue, { startYear: desiredValue?.startYear });
  const current = normalizePatioConfig(currentValue, { startYear: currentValue?.startYear });
  const next = structuredClone(current);

  for (const field of ['startYear', 'courseStart', 'courseEnd', 'zones']) {
    next[field] = mergeField(base[field], desired[field], current[field]);
  }

  const holidays = new Map(current.customHolidays.map((holiday) => [holiday.date, holiday]));
  const baseHolidays = new Map(base.customHolidays.map((holiday) => [holiday.date, holiday]));
  const desiredHolidays = new Map(desired.customHolidays.map((holiday) => [holiday.date, holiday]));
  for (const date of new Set([...baseHolidays.keys(), ...desiredHolidays.keys()])) {
    const before = baseHolidays.get(date);
    const after = desiredHolidays.get(date);
    if (same(before, after)) continue;
    const merged = mergeField(before, after, holidays.get(date));
    if (merged) holidays.set(date, merged);
    else holidays.delete(date);
  }
  next.customHolidays = [...holidays.values()];

  for (const { id: day } of WEEKDAYS) {
    const before = withoutOverrides(base.weekdayTeachers[day]);
    const after = withoutOverrides(desired.weekdayTeachers[day]);
    const latest = current.weekdayTeachers[day];
    if (same(before, after)) continue;
    mergeField(before, after, withoutOverrides(latest));
    const latestById = new Map(latest.map((teacher) => [teacher.teacherId, teacher]));
    next.weekdayTeachers[day] = desired.weekdayTeachers[day].map((teacher) => ({
      ...teacher,
      zoneOverrides: latestById.get(teacher.teacherId)?.zoneOverrides || {},
    }));
  }
  return normalizePatioConfig(next, { startYear: next.startYear });
}

export function applyPatioZoneOverride(config, { day, date, teacherId, zoneId, baseZoneId }) {
  const next = normalizePatioConfig(config, { startYear: config?.startYear });
  const teacher = next.weekdayTeachers[day]?.find((item) => item.teacherId === teacherId);
  if (!teacher || (zoneId && !next.zones.some((zone) => zone.id === zoneId))) {
    throw new Error('La zona o el professor de pati ja no existeixen. Actualitza la jornada.');
  }
  if (zoneId && zoneId !== baseZoneId) teacher.zoneOverrides[date] = zoneId;
  else delete teacher.zoneOverrides[date];
  return normalizePatioConfig(next, { startYear: next.startYear });
}
