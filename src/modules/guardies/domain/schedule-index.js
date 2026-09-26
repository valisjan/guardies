export function createScheduleIndex(sessions) {
  const bySlot = new Map();
  const byTeacherDay = new Map();
  const slots = new Set();
  for (const session of sessions) {
    const slot = `${session.dia}|${session.hora}`;
    const teacherDay = `${session.placa}|${session.dia}`;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    if (!byTeacherDay.has(teacherDay)) byTeacherDay.set(teacherDay, []);
    bySlot.get(slot).push(session);
    byTeacherDay.get(teacherDay).push(session);
    slots.add(slot);
  }
  return { bySlot, byTeacherDay, slots };
}
