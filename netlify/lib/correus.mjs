// Servei de correu de Guàrdies: revisa la cua «guardiesCorreus» i envia els correus que
// ja toquen. Abans d'enviar-ne cap comprova que el canvi encara és vigent: si la guàrdia
// o la zona de pati ja no són les mateixes, el dia ja ha passat, l'enviament al
// professorat està aturat, aquell correu s'ha desactivat o l'adreça és d'una fitxa de
// professorat de baixa, no s'envia. Un avís programat a mà per l'administració
// («manual») surt encara que l'enviament estigui aturat, si continua vigent. Cada 5 minuts
// també revisa els previstos que encara no toquen i anul·la els que ja no calen (la
// guàrdia o la zona han canviat). Els avisos d'un mateix professor per a un mateix dia
// que surten alhora van en un sol correu. Cada avís s'envia com a molt una vegada:
// primer es marca «enviant» i només si això funciona s'envia; si alguna cosa falla a
// mig camí, queda així (es veu a Guàrdies) i no es torna a enviar mai.
import {
  MAIL_KINDS,
  composeMail,
  isSchoolEmail,
  mailDueAt,
  mailToday,
  normalizeMailConfig,
} from '../../src/modules/guardies/domain/mail.js';
import { isActiveTeacherRecord } from '../../src/modules/guardies/domain/teacherDirectory.js';

// firestore: { read, pendingMails, setStatus, teacherRecords, heartbeat } (vegeu firestore-rest.mjs).
// send({ to, subject, text, senderName, replyTo }) envia un correu.
export async function processMailQueue({ firestore, send, account = '', now = new Date(), log = () => {} }) {
  const pending = await firestore.pendingMails();
  // Un senyal cada 10 minuts basta per saber que el servei és viu.
  if (now.getUTCMinutes() % 10 === 0) await firestore.heartbeat(now, account).catch((error) => log(`Senyal: ${error.message}`));
  const today = mailToday(now);
  const cache = { configs: new Map(), days: new Map(), patio: new Map() };
  const summary = { pendents: pending.length, enviats: 0, correus: 0, cancellats: 0, errors: 0, reintents: 0 };
  const setStatus = async (mail, status, reason = '', extra = {}) => {
    try {
      return await firestore.setStatus(mail, status, reason, now, extra);
    } catch (error) {
      log(`No s'ha pogut marcar ${mail.id} com a ${status}: ${error.message}`);
      return false;
    }
  };

  // Els previstos que encara no toquen es revisen cada 5 minuts (per no llegir els dies
  // a cada minut); les proves no cal.
  const reviewScheduled = now.getUTCMinutes() % 5 === 0;
  const groups = new Map();
  for (const mail of pending) {
    const due = mailDueAt(mail).getTime() <= now.getTime();
    if (!due && (!reviewScheduled || mail.kind === 'prova')) continue;
    let decision;
    try {
      decision = await decide(mail, today, firestore, cache, due);
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
    // Encara vigent però no toca: es queda a la cua.
    if (!due) continue;
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
    const sending = message(reserved, cache.configs.get(reserved[0].courseId));
    try {
      await send(sending);
    } catch (error) {
      for (const mail of reserved) await setStatus(mail, 'error', String(error?.message || error).slice(0, 300));
      summary.errors += reserved.length;
      continue;
    }
    // Cada avís guarda el correu tal com ha sortit (el registre de Guàrdies el mostra).
    for (const mail of reserved) await setStatus(mail, 'enviat', '', { subject: sending.subject, text: sending.text });
    summary.enviats += reserved.length;
    summary.correus += 1;
  }
  return summary;
}

function message(mails, config) {
  const [first] = mails;
  const test = first.kind === 'prova';
  const mail = composeMail(config, mails.map((item) => ({ kind: test ? item.template : item.kind, fields: item.fields })));
  return {
    to: first.email,
    subject: (test ? '[Prova] ' : '') + mail.subject,
    text: mail.text,
    senderName: config.senderName,
    replyTo: config.replyTo,
  };
}

// due: el correu ja toca. Si encara no, només s'anul·la si ja no cal; l'interruptor i
// l'activació de cada tipus es miren a l'hora d'enviar-lo (es poden canviar abans).
async function decide(mail, today, firestore, cache, due = true) {
  if (!cache.configs.has(mail.courseId)) {
    cache.configs.set(mail.courseId, normalizeMailConfig(await firestore.read(`cursos/${mail.courseId}/config/guardies-correus`) || {}));
  }
  const config = cache.configs.get(mail.courseId);
  if (!MAIL_KINDS.includes(mail.kind === 'prova' ? mail.template : mail.kind)) return { status: 'error', reason: 'Plantilla desconeguda' };
  if (!isSchoolEmail(mail.email)) return { status: 'error', reason: 'Adreça de fora del centre' };
  if (mail.kind !== 'prova') {
    if (mail.date && mail.date < today) return { status: 'cancel·lat', reason: 'El dia ja ha passat' };
    if (due && !config.active && !mail.manual) return { status: 'cancel·lat', reason: 'Enviament al professorat aturat' };
    if (due && !config[mail.kind].enabled && !mail.manual) return { status: 'cancel·lat', reason: 'Correu desactivat' };
    if (!(await stillValid(mail, firestore, cache))) return { status: 'cancel·lat', reason: 'Ja no és vigent' };
    // Una plaça amb substitut conserva la fitxa de qui és de baixa amb el mateix codi:
    // si l'adreça només és d'una fitxa de baixa, el correu no és per a qui fa la guàrdia.
    if (due) {
      const records = await firestore.teacherRecords(mail.courseId, mail.email);
      if (records.length && !records.some(isActiveTeacherRecord)) return { status: 'cancel·lat', reason: 'Adreça d’una fitxa de professorat de baixa' };
    }
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
