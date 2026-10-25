// Noms de persones: el nom del compte de Google i el de l'horari poden venir en
// ordre diferent ("Nom Cognoms" / "Cognoms, Nom"), amb accents o sense.

export function nameTokens(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 1);
}

// És la mateixa persona? El nom del compte pot no portar el segon llinatge.
export function isSamePerson(viewerName, label) {
  const viewer = nameTokens(viewerName);
  const other = nameTokens(label);
  if (viewer.length < 2 || !other.length) return false;
  if ([...viewer].sort().join('|') === [...other].sort().join('|')) return true;
  return other.length - viewer.length === 1 && viewer.every((token) => other.includes(token));
}
