const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = [
  { id: '1', label: 'Dilluns', short: 'Dl' },
  { id: '2', label: 'Dimarts', short: 'Dt' },
  { id: '3', label: 'Dimecres', short: 'Dc' },
  { id: '4', label: 'Dijous', short: 'Dj' },
  { id: '5', label: 'Divendres', short: 'Dv' },
];

const OFFICIAL_CALENDARS = {
  2026: {
    sourceLabel: 'Calendari escolar CAIB 2026-2027',
    sourceUrl: 'https://intranet.caib.es/sites/planificacioicentres/ca/calendari_escolar_2023-2024/',
    courseStart: '2026-09-10',
    courseEnd: '2027-06-18',
    dates: [
      { date: '2026-10-12', label: 'Festa estatal' },
      { date: '2026-12-08', label: 'Immaculada Concepció' },
      { date: '2027-01-06', label: 'Epifania del Senyor' },
      { date: '2027-02-26', label: 'Festa escolar unificada' },
      { date: '2027-03-01', label: 'Dia de les Illes Balears' },
    ],
    ranges: [
      { start: '2026-12-23', end: '2027-01-06', label: 'Vacances de Nadal' },
      { start: '2027-03-25', end: '2027-04-04', label: 'Vacances de Pasqua' },
    ],
  },
};

function parseDate(value) {
  if (!DATE_RE.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(value, amount) {
  const date = parseDate(value);
  if (!date) return '';
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

export function schoolYearStart(value = '') {
  const explicit = String(value || '').match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (explicit) return Number(explicit[1]);
  const today = new Date();
  return today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
}

export function officialSchoolCalendar(startYear) {
  const year = Number(startYear);
  const calendar = OFFICIAL_CALENDARS[year];
  if (calendar) return structuredClone(calendar);
  return {
    sourceLabel: '',
    sourceUrl: '',
    courseStart: `${year}-09-01`,
    courseEnd: `${year + 1}-06-30`,
    dates: [],
    ranges: [],
  };
}

function normalizeZone(zone, index) {
  const name = String(zone?.name || '').trim().slice(0, 80);
  if (!name) return null;
  return {
    id: String(zone?.id || `zona-${index + 1}`).trim().slice(0, 80),
    name,
  };
}

function normalizeTeacher(teacher, zoneIds) {
  const teacherId = String(teacher?.teacherId || '').trim().slice(0, 100);
  if (!teacherId) return null;
  const startZoneId = zoneIds.has(teacher?.startZoneId) ? teacher.startZoneId : '';
  const zoneOverrides = Object.fromEntries(Object.entries(
    teacher?.zoneOverrides && typeof teacher.zoneOverrides === 'object' ? teacher.zoneOverrides : {},
  )
    .filter(([date, zoneId]) => DATE_RE.test(date) && zoneIds.has(zoneId))
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB)));
  return { teacherId, startZoneId, zoneOverrides };
}

export function normalizePatioConfig(raw = {}, { startYear } = {}) {
  const year = Number(startYear || raw.startYear || schoolYearStart());
  const official = officialSchoolCalendar(year);
  const zones = (Array.isArray(raw.zones) ? raw.zones : [])
    .map(normalizeZone)
    .filter(Boolean);
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const weekdayTeachers = {};
  WEEKDAYS.forEach(({ id }) => {
    weekdayTeachers[id] = (Array.isArray(raw.weekdayTeachers?.[id]) ? raw.weekdayTeachers[id] : [])
      .map((teacher) => normalizeTeacher(teacher, zoneIds))
      .filter(Boolean)
      .filter((teacher, index, list) => list.findIndex((item) => item.teacherId === teacher.teacherId) === index);
  });
  const customHolidays = (Array.isArray(raw.customHolidays) ? raw.customHolidays : [])
    .map((holiday) => ({
      date: DATE_RE.test(holiday?.date || '') ? holiday.date : '',
      label: String(holiday?.label || '').trim().slice(0, 100),
    }))
    .filter((holiday) => holiday.date)
    .filter((holiday, index, list) => list.findIndex((item) => item.date === holiday.date) === index)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    schemaVersion: 1,
    startYear: year,
    courseStart: DATE_RE.test(raw.courseStart || '') ? raw.courseStart : official.courseStart,
    courseEnd: DATE_RE.test(raw.courseEnd || '') ? raw.courseEnd : official.courseEnd,
    zones,
    customHolidays,
    weekdayTeachers,
  };
}

export function datesInRange(start, end) {
  const result = [];
  let cursor = parseDate(start);
  const last = parseDate(end);
  if (!cursor || !last || cursor > last) return result;
  while (cursor <= last) {
    result.push(localDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function nonTeachingDates(config) {
  const normalized = normalizePatioConfig(config, { startYear: config?.startYear });
  const official = officialSchoolCalendar(normalized.startYear);
  const result = new Map();
  official.ranges.forEach((range) => {
    datesInRange(range.start, range.end).forEach((date) => result.set(date, {
      date,
      label: range.label,
      kind: 'official',
    }));
  });
  official.dates.forEach((holiday) => result.set(holiday.date, {
    ...holiday,
    kind: 'official',
  }));
  normalized.customHolidays.forEach((holiday) => result.set(holiday.date, {
    ...holiday,
    label: holiday.label || 'Dia no lectiu del centre',
    kind: 'centre',
  }));
  return result;
}

export function weekdayIdForDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const day = date.getDay();
  return day >= 1 && day <= 5 ? String(day) : '';
}

export function nonTeachingReason(value, config) {
  const date = parseDate(value);
  if (!date) return { date: value, label: 'Data no vàlida', kind: 'invalid' };
  if (value < config.courseStart || value > config.courseEnd) {
    return { date: value, label: 'Fora del curs escolar', kind: 'outside' };
  }
  if (!weekdayIdForDate(value)) return { date: value, label: 'Cap de setmana', kind: 'weekend' };
  return nonTeachingDates(config).get(value) || null;
}

export function teachingOccurrenceIndex(value, config) {
  const weekday = weekdayIdForDate(value);
  if (!weekday || nonTeachingReason(value, config)) return -1;
  let index = 0;
  for (let cursor = config.courseStart; cursor && cursor < value; cursor = addDays(cursor, 1)) {
    if (weekdayIdForDate(cursor) === weekday && !nonTeachingReason(cursor, config)) index += 1;
  }
  return index;
}

export function patioAssignmentsForDate(value, rawConfig) {
  const config = normalizePatioConfig(rawConfig, { startYear: rawConfig?.startYear });
  const weekday = weekdayIdForDate(value);
  const reason = nonTeachingReason(value, config);
  if (!weekday || reason || !config.zones.length) return [];
  const rotation = teachingOccurrenceIndex(value, config);
  return config.weekdayTeachers[weekday].map((teacher, teacherIndex) => {
    let initialZone = config.zones.findIndex((zone) => zone.id === teacher.startZoneId);
    if (initialZone < 0) initialZone = teacherIndex % config.zones.length;
    const baseZone = config.zones[(initialZone + rotation) % config.zones.length];
    const overrideZone = config.zones.find((zone) => zone.id === teacher.zoneOverrides?.[value]);
    const zone = overrideZone || baseZone;
    return {
      ...teacher,
      zoneId: zone.id,
      zoneName: zone.name,
      baseZoneId: baseZone.id,
      baseZoneName: baseZone.name,
      overridden: Boolean(overrideZone && overrideZone.id !== baseZone.id),
      rotation,
    };
  });
}

export function weekDates(value) {
  const date = parseDate(value) || new Date();
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  const monday = localDateString(date);
  return WEEKDAYS.map((_, index) => addDays(monday, index));
}
