// Missatges d'error comprensibles. Els errors de Firebase porten un codi i un
// text tècnic en anglès; els errors propis de l'aplicació ja són en català i
// es mantenen tal qual.
const BY_CODE = {
  'permission-denied': "No tens permís per fer aquesta acció. Torna a iniciar sessió; si continua, avisa l'administració.",
  unauthenticated: 'La sessió ha caducat. Torna a iniciar sessió.',
  unavailable: 'No hi ha connexió amb el servidor. Els canvis es conserven en aquest dispositiu i es tornarà a provar.',
  'deadline-exceeded': 'El servidor ha trigat massa a respondre. Torna-ho a provar.',
  'resource-exhausted': "S'ha superat temporalment el límit d'ús del servidor. Torna-ho a provar d'aquí a una estona.",
  aborted: 'Una altra persona estava desant alhora. Torna-ho a provar.',
  'failed-precondition': 'Una altra persona estava desant alhora. Torna-ho a provar.',
  'not-found': "No s'ha trobat la dada. Potser algú l'ha eliminada.",
  'already-exists': 'Aquesta dada ja existeix.',
  cancelled: "L'operació s'ha cancel·lat.",
  'auth/popup-closed-by-user': "S'ha tancat la finestra d'inici de sessió abans d'acabar.",
  'auth/cancelled-popup-request': "S'ha tancat la finestra d'inici de sessió abans d'acabar.",
  'auth/popup-blocked': "El navegador ha bloquejat la finestra d'inici de sessió. Permet les finestres emergents per a aquesta pàgina.",
  'auth/network-request-failed': 'No hi ha connexió. Comprova la xarxa i torna-ho a provar.',
  'auth/unauthorized-domain': "Aquest domini no està autoritzat per iniciar sessió. Avisa l'administració.",
  'auth/user-disabled': "Aquest compte està desactivat. Avisa l'administració.",
};

const OFFLINE_TEXT = /offline|failed to fetch|network ?error|load failed|networkerror/i;
const PERMISSION_TEXT = /missing or insufficient permissions/i;

export function friendlyError(error) {
  if (!error) return 'Error desconegut.';
  const rawCode = String(error.code || '');
  const code = rawCode.replace(/^firestore\//, '');
  if (BY_CODE[code]) return BY_CODE[code];
  const message = String(error.message || error || '').trim();
  if (PERMISSION_TEXT.test(message)) return BY_CODE['permission-denied'];
  if (OFFLINE_TEXT.test(message)) return BY_CODE.unavailable;
  // Un codi de Firebase sense traducció: missatge genèric amb el codi, útil
  // per al suport, en lloc del text tècnic en anglès.
  if (code && (code.startsWith('auth/') || /^[a-z-]+$/.test(code)) && !code.startsWith('guardies/')) {
    return `S'ha produït un error inesperat (${code}). Torna-ho a provar.`;
  }
  return message || 'Error desconegut.';
}
