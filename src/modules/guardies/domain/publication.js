export function publicProjectionForDay(projection, day, courseId, date) {
  if (!projection || !['published', 'closed'].includes(day?.status)) return null;
  return {
    ...projection, schemaVersion: 1, courseId, date,
    status: day.status, revision: Number(day.revision) || 0,
    publishedAt: day.publishedAt || '', clientUpdatedAt: day.clientUpdatedAt || '',
  };
}

export function publicProjectionsEqual(left, right) {
  // Firestore does not preserve the insertion order of nested map keys.
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
    return value;
  };
  const comparable = (value) => value ? {
    schemaVersion: value.schemaVersion, courseId: value.courseId, date: value.date,
    status: value.status, revision: value.revision, publishedAt: value.publishedAt || '',
    clientUpdatedAt: value.clientUpdatedAt || '', hours: value.hours, groupsOut: value.groupsOut,
  } : null;
  return JSON.stringify(canonical(comparable(left))) === JSON.stringify(canonical(comparable(right)));
}
