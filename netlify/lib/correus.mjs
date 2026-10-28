// Servei de correu de Guàrdies: revisa la cua «guardiesCorreus» i envia els correus que
// ja toquen. Abans d'enviar-ne cap comprova que el canvi encara és vigent: si la guàrdia
// o la zona de pati ja no són les mateixes, el dia ja ha passat, l'enviament al
// professorat està aturat o aquell correu s'ha desactivat, no s'envia. Els avisos d'un
// mateix professor per a un mateix dia que surten alhora van en un sol correu. Cada avís
// s'envia com a molt una vegada: primer es marca «enviant» i només si això funciona
// s'envia; si alguna cosa falla a mig camí, queda així (es veu a Guàrdies) i no es torna
// a enviar mai.
import {
  MAIL_EXAMPLE_FIELDS,
  composeMail,
  isSchoolEmail,
  mailDueAt,
  mailToday,
  normalizeMailConfig,
} from '../../src/modules/guardies/domain/mail.js';

// firestore: { read, pendingMails, setStatus, heartbeat } (vegeu firestore-rest.mjs).
// send({ to, subject, text, senderName, replyTo }) envia un correu.
export async function processMailQueue({ firestore, send, account = '', now = new Date(), log = () => {} }) {
  const pending = await firestore.pendingMails();
  // Un senyal cada 10 minuts basta per saber que el servei és viu.
  if (now.getUTCMinutes() % 10 === 0) await firestore.heartbeat(now, account).catch((error) => log(`Senyal: ${error.message}`));
  const today = mailToday(now);
  const cache = { configs: new Map(), days: new Map(), patio: new Map() };
  const summary = { pendents: pending.length, enviats: 0, correus: 0, cancellats: 0, errors: 0, reintents: 0 };
  const setStatus = async (mail, status, reason = '') => {
    try {
      return await firestore.setStatus(mail, status, reason, now);
    } catch (error) {
      log(`No s'ha pogut marcar ${mail.id} com a ${status}: ${error.message}`);
      return false;
    }
  };

  const groups = new Map();
  for (const mail of pending.filter((item) => mailDueAt(item).getTime() <= now.getTime())) {
    let decision;
    try {
      decision = await decide(mail, today, firestore, cache);
    } catch (error) {
      // No s'ha pogut llegir Firestore: es torna a provar a la propera revisió.
      log(`No s'ha pogut revisar ${mail.id}: ${error.message}`);
      summary.reintents += 1;
      continue;
    }
    if (decision.status) {
      if (!(await setStatus(mail, decision.status, decision.reason))) summary.reintents += 1;
      else if (decision.status === 'error') summary.errors += 1;
      else summary.cancellats += 1;
      continue;
    }
    // Un correu per professor i dia; cada prova, a part.
    const key = mail.kind === 'prova' ? `prova:${mail.id}` : [mail.courseId, mail.email, mail.date].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mail);
  }

  for (const mails of groups.values()) {
    const reserved = [];
    for (const mail of mails) {
      if (await setStatus(mail, 'enviant')) reserved.push(mail);
      else summary.reintents += 1;
    }
    if (!reserved.length) continue;
    try {
      await send(message(reserved, cache.configs.get(reserved[0].courseId)));
    } catch (error) {
      for (const mail of reserved) await setStatus(mail, 'error', String(error?.message || error).slice(0, 300));
      summary.errors += reserved.length;
      continue;
    }
    for (const mail of reserved) await setStatus(mail, 'enviat');
    summary.enviats += reserved.length;
    summary.correus += 1;
  }
  return summary;
}

function message(mails, config) {
  const [first] = mails;
  const test = first.kind === 'prova';
  // La prova «combinat» mostra com queda un correu amb dos avisos del mateix dia.
  const notices = test
    ? (first.template === 'combinat' ? ['alliberat', 'pati'] : [first.template])
      .map((kind) => ({ kind, fields: first.template === 'combinat' ? MAIL_EXAMPLE_FIELDS[kind] : first.fields }))
    : mails.map((mail) => ({ kind: mail.kind, fields: mail.fields }));
  const mail = composeMail(config, notices);
  return {
    to: first.email,
    subject: (test ? '[Prova] ' : '') + mail.subject,
    text: mail.text,
    senderName: config.senderName,
    replyTo: config.replyTo,
  };
}

async function decide(mail, today, firestore, cache) {
  if (!cache.configs.has(mail.courseId)) {
    cache.configs.set(mail.courseId, normalizeMailConfig(await firestore.read(`cursos/${mail.courseId}/config/guardies-correus`) || {}));
  }
  const config = cache.configs.get(mail.courseId);
  const known = mail.kind === 'prova' ? [...Object.keys(MAIL_EXAMPLE_FIELDS), 'combinat'].includes(mail.template) : Boolean(config[mail.kind]);
  if (!known) return { status: 'error', reason: 'Plantilla desconeguda' };
  if (!isSchoolEmail(mail.email)) return { status: 'error', reason: 'Adreça de fora del centre' };
  if (mail.kind !== 'prova') {
    if (mail.date && mail.date < today) return { status: 'cancel·lat', reason: 'El dia ja ha passat' };
    if (!config.active) return { status: 'cancel·lat', reason: 'Enviament al professorat aturat' };
    if (!config[mail.kind].enabled) return { status: 'cancel·lat', reason: 'Correu desactivat' };
    if (!(await stillValid(mail, firestore, cache))) return { status: 'cancel·lat', reason: 'Ja no és vigent' };
  }
  return {};
}

// El canvi que va generar el correu encara és el que hi ha ara?
async function stillValid(mail, firestore, cache) {
  const check = mail.check || {};
  if (mail.kind === 'alliberat') {
    const key = `${mail.courseId}/${mail.date}`;
    if (!cache.days.has(key)) cache.days.set(key, await firestore.read(`cursos/${mail.courseId}/guardiesDays/${mail.date}`));
    const day = cache.days.get(key);
    const id = check.absenceId;
    if (!day || !id || !(day.absenceIds || []).includes(id) || (day.cancelledAssignments || []).includes(id)) return false;
    const assignment = (day.assignments || {})[id];
    const teacherId = typeof assignment === 'string' ? assignment : assignment?.teacherId;
    return Boolean(assignment && teacherId === mail.teacherId && assignment.source === 'released');
  }
  if (mail.kind === 'pati') {
    if (!cache.patio.has(mail.courseId)) cache.patio.set(mail.courseId, await firestore.read(`cursos/${mail.courseId}/guardies/pati`));
    const teachers = cache.patio.get(mail.courseId)?.weekdayTeachers?.[check.day] || [];
    const teacher = teachers.find((item) => item.teacherId === mail.teacherId);
    return teacher?.zoneOverrides?.[mail.date] === check.zoneId;
  }
  return false;
}
