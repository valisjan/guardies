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
