export const E2E_AUTH_BYPASS = import.meta.env.VITE_E2E_AUTH_BYPASS === 'true';

export const E2E_CURS_ID = 'e2e-2026';

const classes = [
  {
    id: 'e2e-classe-cat',
    curs: '1ESO',
    grup: 'A',
    materia: 'Llengua catalana i literatura',
    hores: 3,
    departament: 'Catala',
    departaments: ['Catala'],
    tipus: '',
    professorAssignat: 'Maria Sureda',
    professors: ['Maria Sureda'],
    participants: [],
  },
  {
    id: 'e2e-classe-opt',
    curs: '1ESO',
    grup: 'A',
    materia: 'Taller de lectura',
    hores: 2,
    departament: 'Catala',
    departaments: ['Catala'],
    tipus: 'O1',
    professorAssignat: '',
    professors: [],
    participants: [],
  },
  {
    id: 'e2e-classe-cd',
    curs: '1ESO',
    grup: 'A',
    materia: 'Matematiques',
    hores: 1,
    departament: 'Matematiques',
    departaments: ['Matematiques'],
    tipus: 'CD',
    professorAssignat: 'Pere Blanes',
    professors: ['Pere Blanes'],
    participants: [],
  },
  {
    id: 'e2e-classe-coord',
    curs: '',
    grup: '',
    materia: 'Coordinacio TIC',
    hores: 2,
    departament: 'Tecnologia',
    departaments: ['Tecnologia'],
    tipus: 'C',
    professorAssignat: 'Joana Pons',
    professors: ['Joana Pons'],
    participants: ['Joana Pons'],
  },
];

const professors = [
  {
    id: 'e2e-prof-cat',
    nom: 'Maria Sureda',
    departament: 'Catala',
    jornada: '',
    codiUntis: 'MSUR',
    email: 'maria.sureda@iesjosepsuredaiblanes.com',
    rol: 'cap_departament',
    gpAssignades: 0,
    palicAssignades: 0,
    sdAssignades: 0,
    sdAssignacions: [],
    ddAssignades: 0,
    ddAssignacions: [],
  },
  {
    id: 'e2e-prof-mat',
    nom: 'Pere Blanes',
    departament: 'Matematiques',
    jornada: '',
    codiUntis: 'PBLA',
    email: 'pere.blanes@iesjosepsuredaiblanes.com',
    rol: 'professor',
    gpAssignades: 0,
    palicAssignades: 0,
    sdAssignades: 0,
    sdAssignacions: [],
    ddAssignades: 0,
    ddAssignacions: [],
  },
  {
    id: 'e2e-prof-tec',
    nom: 'Joana Pons',
    departament: 'Tecnologia',
    jornada: '',
    codiUntis: 'JPON',
    email: 'joana.pons@iesjosepsuredaiblanes.com',
    rol: 'professor',
    gpAssignades: 0,
    palicAssignades: 0,
    sdAssignades: 0,
    sdAssignacions: [],
    ddAssignades: 0,
    ddAssignacions: [],
  },
];

const departaments = [
  { id: 'e2e-dep-cat', nom: 'Catala', tancat: false },
  { id: 'e2e-dep-mat', nom: 'Matematiques', tancat: false },
  { id: 'e2e-dep-tec', nom: 'Tecnologia', tancat: false },
];

const syncHistory = [
  {
    id: 'e2e-sync-1',
    actor: 'E2E Admin',
    total: classes.length,
    totalProfs: professors.length,
    totalDeps: departaments.length,
    afegides: 0,
    actualitzades: 0,
    eliminades: 0,
    assignacionsConservades: 0,
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
];

const collections = {
  classes,
  professors,
  departaments,
  sync_history: syncHistory,
};

export function getE2ECollection(name) {
  return (collections[name] || []).map((item) => ({
    ...item,
    departaments: item.departaments ? [...item.departaments] : item.departaments,
    professors: item.professors ? [...item.professors] : item.professors,
    participants: item.participants ? [...item.participants] : item.participants,
    sdAssignacions: item.sdAssignacions ? [...item.sdAssignacions] : item.sdAssignacions,
  }));
}

export function getE2ECursos() {
  return [{ id: E2E_CURS_ID, nom: 'E2E 2026-27', bloqueig: false }];
}
