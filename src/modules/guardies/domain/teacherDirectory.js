// Fitxes del professorat de Quota (cursos/{curs}/professors) que Guàrdies fa servir per al
// nom i el correu. Quan una plaça té substitut, la fitxa de qui és de baixa conserva el
// codi Untis de la plaça (TORR, ADEL…): si comptés, el correu del substitut aniria a qui
// és de baixa.

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

// De baixa, desactivada o treta del professorat: no és qui ocupa la plaça.
export function isActiveTeacherRecord(data = {}) {
  return !data.desactivatAt && data.eliminatDelFull !== true && !String(data.motiuBaixa || '').trim();
}

// La fitxa d'una plaça a partir dels seus noms (plaça, codi Untis…): entre les actives,
// primer la que en té l'identificador i, si no n'hi ha cap, la que en té el codi Untis.
export function findDirectoryTeacher(directory = [], aliases = []) {
  const keys = new Set(Array.from(aliases, normalize).filter(Boolean));
  const active = directory.filter((teacher) => teacher.active !== false);
  return active.find((teacher) => keys.has(normalize(teacher.id)))
    || active.find((teacher) => keys.has(normalize(teacher.codiUntis)))
    || null;
}
