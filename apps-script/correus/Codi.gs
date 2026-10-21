// Servei de correu de Guàrdies (IES Josep Sureda i Blanes).
//
// Cada minut revisa la cua «guardiesCorreus» de Firestore (projecte quota-e1424) i envia
// els correus que ja toquen des del compte de Google que executa aquest script. Abans
// d'enviar-ne cap comprova que el canvi encara és vigent: si la guàrdia o la zona de
// pati ja no són les mateixes, no l'envia. Els textos es configuren a Guàrdies ›
// Configuració › Correus al professorat. Instal·lació: vegeu README.md.

const PROJECTE = 'quota-e1424';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECTE}/databases/(default)/documents`;
const ZONA = 'Europe/Madrid';
const DOMINI = '@iesjosepsuredaiblanes.com';
const BATEC_CADA_MINUTS = 10;

// Els mateixos textos per defecte que Guàrdies (src/modules/guardies/domain/mail.js).
const PER_DEFECTE = {
  senderName: 'Guàrdies · IES Josep Sureda i Blanes',
  replyTo: '',
  alliberat: {
    enabled: true,
    subject: 'Guàrdia com a alliberat/da el {data} a {hora}',
    body: 'Benvolgut/da {nom},\n\nSe us ha assignat una guàrdia amb el grup {grup}, com a alliberat/da, el {data} a {hora}.\n\nGràcies.',
  },
  pati: {
    enabled: true,
    subject: 'Zona de guàrdia de pati el {data}',
    body: 'Benvolgut/da {nom},\n\nSe us ha assignat la zona {zona} de guàrdia de pati el {data}, en lloc de la vostra zona habitual ({zona_habitual}).\n\nGràcies.',
  },
};

// Executa-ho una vegada a mà: crea l'activador de cada minut i fa una primera revisió.
function installa() {
  desinstalla();
  ScriptApp.newTrigger('revisaCua').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteProperty('darrerBatec');
  Logger.log(`Activador creat. Correus pendents ara: ${consultaPendents().length}.`);
  revisaCua();
}

function desinstalla() {
  ScriptApp.getProjectTriggers()
    .filter((activador) => activador.getHandlerFunction() === 'revisaCua')
    .forEach((activador) => ScriptApp.deleteTrigger(activador));
}

function revisaCua() {
  const bloqueig = LockService.getScriptLock();
  if (!bloqueig.tryLock(1000)) return;
  try {
    const ara = new Date();
    const hora = Number(Utilities.formatDate(ara, ZONA, 'H'));
    // De nit no hi ha res a fer: els correus pendents surten a partir de les 8:00.
    if (hora < 7 || hora >= 22) return;
    const pendents = consultaPendents();
    batec(ara);
    const avui = Utilities.formatDate(ara, ZONA, 'yyyy-MM-dd');
    const memoria = { configs: {}, dies: {}, patis: {} };
    pendents
      .filter((correu) => new Date(correu.sendAfter).getTime() <= ara.getTime())
      .forEach((correu) => processa(correu, avui, memoria));
  } finally {
    bloqueig.releaseLock();
  }
}

// Cada correu s'envia com a molt una vegada: primer es marca «enviant» i només si això
// funciona s'envia. Si alguna cosa falla a mig camí, queda «enviant» (es veu a Guàrdies)
// i no es torna a enviar mai: val més un correu perdut que un correu cada minut.
function processa(correu, avui, memoria) {
  let decisio;
  try {
    decisio = decideix(correu, avui, memoria);
  } catch (error) {
    // No s'ha pogut llegir Firestore: es torna a provar a la propera revisió.
    Logger.log(`No s'ha pogut revisar ${correu.nomDocument}: ${(error && error.message) || error}`);
    return;
  }
  if (decisio.estat) {
    canviaEstat(correu, decisio.estat, decisio.motiu);
    return;
  }
  if (!canviaEstat(correu, 'enviant', '')) return;
  try {
    MailApp.sendEmail(decisio.missatge);
  } catch (error) {
    canviaEstat(correu, 'error', String((error && error.message) || error).slice(0, 300));
    return;
  }
  canviaEstat(correu, 'enviat', '');
}

function decideix(correu, avui, memoria) {
  const config = configuracio(correu.courseId, memoria);
  const plantilla = config[correu.template] || config[correu.kind];
  if (!plantilla) return { estat: 'error', motiu: 'Plantilla desconeguda' };
  if (!String(correu.email || '').toLowerCase().endsWith(DOMINI)) return { estat: 'error', motiu: 'Adreça de fora del centre' };
  if (correu.kind !== 'prova') {
    if (!plantilla.enabled) return { estat: 'cancel·lat', motiu: 'Correu desactivat' };
    if (correu.date && correu.date < avui) return { estat: 'cancel·lat', motiu: 'El dia ja ha passat' };
    if (!vigent(correu, memoria)) return { estat: 'cancel·lat', motiu: 'Ja no és vigent' };
  }
  const missatge = {
    to: correu.email,
    subject: (correu.kind === 'prova' ? '[Prova] ' : '') + omple(plantilla.subject, correu.fields),
    body: omple(plantilla.body, correu.fields),
    name: config.senderName || PER_DEFECTE.senderName,
  };
  if (config.replyTo) missatge.replyTo = config.replyTo;
  return { missatge };
}

// El canvi que va generar el correu encara és el que hi ha ara?
function vigent(correu, memoria) {
  const comprova = correu.check || {};
  if (correu.kind === 'alliberat') {
    const clau = `${correu.courseId}/${correu.date}`;
    if (!(clau in memoria.dies)) memoria.dies[clau] = llegeix(`cursos/${correu.courseId}/guardiesDays/${correu.date}`);
    const dia = memoria.dies[clau];
    const id = comprova.absenceId;
    if (!dia || !id || (dia.absenceIds || []).indexOf(id) < 0 || (dia.cancelledAssignments || []).indexOf(id) >= 0) return false;
    const assignacio = (dia.assignments || {})[id];
    const professor = typeof assignacio === 'string' ? assignacio : assignacio && assignacio.teacherId;
    return Boolean(assignacio && professor === correu.teacherId && assignacio.source === 'released');
  }
  if (correu.kind === 'pati') {
    if (!(correu.courseId in memoria.patis)) memoria.patis[correu.courseId] = llegeix(`cursos/${correu.courseId}/guardies/pati`);
    const pati = memoria.patis[correu.courseId];
    const professors = (pati && pati.weekdayTeachers && pati.weekdayTeachers[comprova.day]) || [];
    const professor = professors.find((item) => item.teacherId === correu.teacherId);
    return Boolean(professor && professor.zoneOverrides && professor.zoneOverrides[correu.date] === comprova.zoneId);
  }
  return false;
}

function configuracio(curs, memoria) {
  if (!(curs in memoria.configs)) {
    const desada = llegeix(`cursos/${curs}/config/guardies-correus`) || {};
    memoria.configs[curs] = {
      senderName: desada.senderName || PER_DEFECTE.senderName,
      replyTo: desada.replyTo || '',
      alliberat: Object.assign({}, PER_DEFECTE.alliberat, desada.alliberat || {}),
      pati: Object.assign({}, PER_DEFECTE.pati, desada.pati || {}),
    };
  }
  return memoria.configs[curs];
}

function omple(plantilla, camps) {
  return String(plantilla || '').replace(/\{([a-z_]+)\}/g, (text, clau) => (
    camps && Object.prototype.hasOwnProperty.call(camps, clau) ? String(camps[clau]) : text
  ));
}

// Senyal per a Guàrdies que el servei funciona (com a molt, una escriptura cada 10 minuts).
function batec(ara) {
  const propietats = PropertiesService.getScriptProperties();
  if (ara.getTime() - Number(propietats.getProperty('darrerBatec') || 0) < BATEC_CADA_MINUTS * 60 * 1000) return;
  peticio('patch', `${FIRESTORE}/config/guardies-correus?updateMask.fieldPaths=lastRunAt&updateMask.fieldPaths=account`, {
    fields: {
      lastRunAt: { timestampValue: ara.toISOString() },
      account: { stringValue: Session.getEffectiveUser().getEmail() || '' },
    },
  });
  propietats.setProperty('darrerBatec', String(ara.getTime()));
}

// ---- Firestore (REST) ------------------------------------------------------------

function peticio(metode, url, cos) {
  const opcions = {
    method: metode,
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
  };
  if (cos) opcions.payload = JSON.stringify(cos);
  const resposta = UrlFetchApp.fetch(url, opcions);
  const codi = resposta.getResponseCode();
  if (codi === 404) return null;
  if (codi >= 300) throw new Error(`Firestore ${codi}: ${resposta.getContentText().slice(0, 300)}`);
  return JSON.parse(resposta.getContentText() || '{}');
}

function llegeix(ruta) {
  const document = peticio('get', `${FIRESTORE}/${ruta}`);
  return document ? desxifra({ mapValue: { fields: document.fields || {} } }) : null;
}

function consultaPendents() {
  const files = peticio('post', `${FIRESTORE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: 'guardiesCorreus' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pendent' } } },
      limit: 200,
    },
  }) || [];
  return files.filter((fila) => fila.document).map((fila) => Object.assign(
    desxifra({ mapValue: { fields: fila.document.fields || {} } }),
    { nomDocument: fila.document.name, actualitzat: fila.document.updateTime },
  ));
}

// Canvia l'estat només si ningú no ha tornat a programar el correu des que s'ha llegit
// (precondició sobre l'hora de la darrera escriptura). Si Guàrdies l'ha canviat, queda
// pendent amb el contingut nou i surt a la propera revisió. Retorna si s'ha canviat.
function canviaEstat(correu, estat, motiu) {
  const camps = { status: { stringValue: estat }, reason: { stringValue: motiu || '' } };
  const mascara = ['status', 'reason'];
  if (estat === 'enviat') {
    camps.sentAt = { timestampValue: new Date().toISOString() };
    mascara.push('sentAt');
  }
  try {
    const resultat = peticio('post', `${FIRESTORE}:commit`, {
      writes: [{
        update: { name: correu.nomDocument, fields: camps },
        updateMask: { fieldPaths: mascara },
        currentDocument: { updateTime: correu.actualitzat },
      }],
    });
    correu.actualitzat = resultat.writeResults[0].updateTime;
    return true;
  } catch (error) {
    if (!/FAILED_PRECONDITION/.test(String(error.message))) {
      Logger.log(`No s'ha pogut marcar ${correu.nomDocument} com a ${estat}: ${error.message}`);
    }
    return false;
  }
}

function desxifra(valor) {
  if (!valor) return null;
  if ('stringValue' in valor) return valor.stringValue;
  if ('integerValue' in valor) return Number(valor.integerValue);
  if ('doubleValue' in valor) return valor.doubleValue;
  if ('booleanValue' in valor) return valor.booleanValue;
  if ('timestampValue' in valor) return valor.timestampValue;
  if ('nullValue' in valor) return null;
  if ('arrayValue' in valor) return (valor.arrayValue.values || []).map(desxifra);
  if ('mapValue' in valor) {
    const sortida = {};
    Object.keys(valor.mapValue.fields || {}).forEach((clau) => { sortida[clau] = desxifra(valor.mapValue.fields[clau]); });
    return sortida;
  }
  return null;
}
