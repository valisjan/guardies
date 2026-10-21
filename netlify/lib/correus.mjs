// Servei de correu de Guàrdies: revisa la cua «guardiesCorreus» i envia els correus que
// ja toquen. Abans d'enviar-ne cap comprova que el canvi encara és vigent: si la guàrdia
// o la zona de pati ja no són les mateixes, el dia ja ha passat o aquell correu s'ha
// desactivat, no s'envia. Cada correu s'envia com a molt una vegada: primer es marca
// «enviant» i només si això funciona s'envia; si alguna cosa falla a mig camí, queda així
// (es veu a Guàrdies) i no es torna a enviar mai.
import { MAIL_TIME_ZONE, normalizeMailConfig, renderMailTemplate } from '../../src/modules/guardies/domain/mail.js';

const DOMAIN = '@iesjosepsuredaiblanes.com';

const todayIn = (now, timeZone = MAIL_TIME_ZONE) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

// firestore: { read, pendingMails, setStatus, heartbeat } (vegeu firestore-rest.mjs).
// send({ to, subject, text, senderName, replyTo }) envia un correu.
export async function processMailQueue({ firestore, send, account = '', now = new Date(), log = () => {} }) {
  const pending = await firestore.pendingMails();
  // Un senyal cada 10 minuts basta per saber que el servei és viu.
  if (now.getUTCMinutes() % 10 === 0) await firestore.heartbeat(now, account).catch((error) => log(`Senyal: ${error.message}`));
  const today = todayIn(now);
  const cache = { configs: new Map(), days: new Map(), patio: new Map() };
  const summary = { pendents: pending.length, enviats: 0, cancellats: 0, errors: 0, reintents: 0 };
  for (const mail of pending.filter((item) => new Date(item.sendAfter).getTime() <= now.getTime())) {
    const result = await processMail(mail, { firestore, send, today, cache, now, log });
    if (result === 'enviat') summary.enviats += 1;
    else if (result === 'cancel·lat') summary.cancellats += 1;
    else if (result === 'error') summary.errors += 1;
    else summary.reintents += 1;
  }
  return summary;
}

async function processMail(mail, { firestore, send, today, cache, now, log }) {
  let decision;
  try {
    decision = await decide(mail, today, firestore, cache);
  } catch (error) {
    // No s'ha pogut llegir Firestore: es torna a provar a la propera revisió.
    log(`No s'ha pogut revisar ${mail.id}: ${error.message}`);
    return 'reintent';
  }
  const setStatus = async (status, reason = '') => {
    try {
      return await firestore.setStatus(mail, status, reason, now);
    } catch (error) {
      log(`No s'ha pogut marcar ${mail.id} com a ${status}: ${error.message}`);
      return false;
    }
  };
  if (decision.status) return (await setStatus(decision.status, decision.reason)) ? decision.status : 'reintent';
  if (!(await setStatus('enviant'))) return 'reintent';
  try {
    await send(decision.message);
  } catch (error) {
    await setStatus('error', String(error?.message || error).slice(0, 300));
    return 'error';
  }
  await setStatus('enviat');
  return 'enviat';
}

async function decide(mail, today, firestore, cache) {
  if (!cache.configs.has(mail.courseId)) {
    cache.configs.set(mail.courseId, normalizeMailConfig(await firestore.read(`cursos/${mail.courseId}/config/guardies-correus`) || {}));
  }
  const config = cache.configs.get(mail.courseId);
  const template = config[mail.template] || config[mail.kind];
  if (!template) return { status: 'error', reason: 'Plantilla desconeguda' };
  if (!String(mail.email || '').toLowerCase().endsWith(DOMAIN)) return { status: 'error', reason: 'Adreça de fora del centre' };
  if (mail.kind !== 'prova') {
    if (!template.enabled) return { status: 'cancel·lat', reason: 'Correu desactivat' };
    if (mail.date && mail.date < today) return { status: 'cancel·lat', reason: 'El dia ja ha passat' };
    if (!(await stillValid(mail, firestore, cache))) return { status: 'cancel·lat', reason: 'Ja no és vigent' };
  }
  return {
    message: {
      to: mail.email,
      subject: (mail.kind === 'prova' ? '[Prova] ' : '') + renderMailTemplate(template.subject, mail.fields),
      text: renderMailTemplate(template.body, mail.fields),
      senderName: config.senderName,
      replyTo: config.replyTo,
    },
  };
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
