export const GUARDIES_SCHEMA_VERSION = 1;

export const DAY_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CLOSED: 'closed',
});

export const ABSENCE_STATUS = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
});

export const COVERAGE_SOURCE = Object.freeze({
  DUTY: 'duty',
  RELEASED: 'released',
  CONVIVENCIA: 'convivencia',
  MANUAL: 'manual',
});

export const FILE_KIND = Object.freeze({
  REFERENCE: 'reference',
  TEACHERS: 'teachers',
  SCHEDULE: 'schedule',
  DUTIES: 'duties',
});

const DAY_STATUSES = new Set(Object.values(DAY_STATUS));
const ABSENCE_STATUSES = new Set(Object.values(ABSENCE_STATUS));
const COVERAGE_SOURCES = new Set(Object.values(COVERAGE_SOURCE));

function requiredString(value, field) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${field} és obligatori.`);
  return result;
}
function optionalString(value) {
  return String(value ?? '').trim();
}

function enumValue(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`${field} no és vàlid.`);
  return value;
}

export function assertIsoDate(value, field = 'date') {
  const date = requiredString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${field} ha de tenir format YYYY-MM-DD.`);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${field} no és una data vàlida.`);
  }
  return date;
}

export function slotId(weekday, periodId) {
  const day = Number(weekday);
  if (!Number.isInteger(day) || day < 1 || day > 5) throw new Error('weekday ha d\'estar entre 1 i 5.');
  const period = requiredString(periodId, 'periodId');
  return `${day}_${encodeURIComponent(period)}`;
}

export function absenceId({ date, teacherId, slotId: slot, scheduleBlockId }) {
  return [
    assertIsoDate(date),
    requiredString(teacherId, 'teacherId'),
    requiredString(slot, 'slotId'),
    requiredString(scheduleBlockId, 'scheduleBlockId'),
  ].map(encodeURIComponent).join('__');
}

export function createGuardiesDay(input) {
  const status = input.status || DAY_STATUS.DRAFT;
  return {
    schemaVersion: GUARDIES_SCHEMA_VERSION,
    courseId: requiredString(input.courseId, 'courseId'),
    date: assertIsoDate(input.date),
    scheduleRevisionId: requiredString(input.scheduleRevisionId, 'scheduleRevisionId'),
    status: enumValue(status, DAY_STATUSES, 'status'),
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    notes: optionalString(input.notes),
  };
}

export function createAbsence(input) {
  const absence = {
    schemaVersion: GUARDIES_SCHEMA_VERSION,
    date: assertIsoDate(input.date),
    teacherId: requiredString(input.teacherId, 'teacherId'),
    slotId: requiredString(input.slotId, 'slotId'),
    scheduleBlockId: requiredString(input.scheduleBlockId, 'scheduleBlockId'),
    sessionIds: Array.from(new Set((input.sessionIds || []).map(String).filter(Boolean))).sort(),
    comment: optionalString(input.comment),
    status: enumValue(input.status || ABSENCE_STATUS.ACTIVE, ABSENCE_STATUSES, 'status'),
  };
  return { id: absenceId(absence), ...absence };
}

export function createCoverage(input, absence) {
  const absenceTeacherId = requiredString(absence?.teacherId, 'absence.teacherId');
  const teacherId = requiredString(input.teacherId, 'teacherId');
  if (teacherId === absenceTeacherId) throw new Error('Un professor absent no es pot cobrir a si mateix.');
  return {
    schemaVersion: GUARDIES_SCHEMA_VERSION,
    absenceId: requiredString(absence.id, 'absence.id'),
    teacherId,
    source: enumValue(input.source, COVERAGE_SOURCES, 'source'),
    comment: optionalString(input.comment),
  };
}

export function canTransitionDay(from, to) {
  if (from === to) return true;
  return (
    (from === DAY_STATUS.DRAFT && to === DAY_STATUS.PUBLISHED) ||
    (from === DAY_STATUS.PUBLISHED && [DAY_STATUS.DRAFT, DAY_STATUS.CLOSED].includes(to)) ||
    (from === DAY_STATUS.CLOSED && to === DAY_STATUS.PUBLISHED)
  );
}

export function isReleasedTeachingBlock(block, groupsOut, enabledTeachersByGroup) {
  const groups = Array.from(new Set(block?.groupIds || [])).filter(Boolean);
  if (!groups.length) return false;
  const teacherKey = `${requiredString(block.slotId, 'block.slotId')}|${requiredString(block.teacherId, 'block.teacherId')}`;
  return groups.every((groupId) => (
    groupsOut.has(groupId) && enabledTeachersByGroup.get(groupId)?.has(teacherKey)
  ));
}
