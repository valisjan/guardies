// Correus automàtics al professorat: només quan se li assigna una guàrdia com a
// alliberat/da o, a mà, una zona de pati diferent de la seva. Aquí hi ha la lògica
// pura: quan surt cada correu, quins camps s'omplen i com queda el text. Els
// envia el servei de correu (netlify/functions/correus-guardies.mjs) a partir de la
// cua de Firestore.

export const MAIL_TIME_ZONE = 'Europe/Madrid';
// Un correu surt el mateix dia de l'avís: els canvis per a avui, entre les 8:00 i les
// 15:00, al cap de 5 minuts (per si el canvi es desfà); els d'un altre dia, a les 8:00
// d'aquell dia.
export const MAIL_WINDOW = { start: 8 * 60, end: 15 * 60, delayMinutes: 5 };

export const MAIL_KINDS = ['alliberat', 'pati'];

// Les proves i els avisos només poden anar a adreces del centre.
export const MAIL_DOMAINS = ['@iesjosepsuredaiblanes.com', '@iessureda.com'];

export const MAIL_FIELDS = {
  alliberat: [
    ['nom', 'nom de pila'],
    ['nom_complet', 'nom i llinatges'],
    ['data', 'data (dd/mm/aaaa)'],
    ['dia', 'dia de la setmana'],
    ['hora', 'hora de classe (4a hora)'],
    ['horari', 'hora d\'inici (11:15)'],
    ['grup', 'grup'],
    ['materia', 'matèria'],
    ['aula', 'aula'],
  ],
  pati: [
    ['nom', 'nom de pila'],
    ['nom_complet', 'nom i llinatges'],
    ['data', 'data (dd/mm/aaaa)'],
    ['dia', 'dia de la setmana'],
    ['zona', 'zona assignada'],
    ['zona_habitual', 'zona habitual'],
  ],
};

export const MAIL_EXAMPLE_FIELDS = {
  alliberat: {
    nom: 'Marina', nom_complet: 'Marina Adell Domènech', data: '20/10/2026', dia: 'dimarts',
    hora: '4a hora', horari: '11:15', grup: '3ESO-B', materia: 'Matemàtiques', aula: 'Aula 14',
  },
  pati: {
    nom: 'Marina', nom_complet: 'Marina Adell Domènech', data: '20/10/2026', dia: 'dimarts',
    zona: 'Porxada', zona_habitual: 'Pista',
  },
};

// Mentre «active» és fals no s'envia res al professorat (les proves sí).
export const DEFAULT_MAIL_CONFIG = {
  active: false,
  testEmail: '',
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

// Assumpte del correu que porta més d'un avís del mateix dia.
export const MAIL_COMBINED_SUBJECT = 'Avisos de guàrdies per al {dia} {data}';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (value, max) => String(value ?? '').slice(0, max);
const textOr = (value, fallback, max) => text(typeof value === 'string' ? value : fallback, max);

export function isSchoolEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL.test(email) && MAIL_DOMAINS.some((domain) => email.endsWith(domain));
}

export function normalizeMailConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const template = (kind) => {
    const value = config[kind] && typeof config[kind] === 'object' ? config[kind] : {};
    const fallback = DEFAULT_MAIL_CONFIG[kind];
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
      subject: textOr(value.subject, fallback.subject, 200),
      body: textOr(value.body, fallback.body, 4000),
    };
  };
  const replyTo = text(config.replyTo, 320).trim();
  const testEmail = text(config.testEmail, 320).trim().toLowerCase();
  return {
    active: config.active === true,
    testEmail: isSchoolEmail(testEmail) ? testEmail : '',
    senderName: textOr(config.senderName, DEFAULT_MAIL_CONFIG.senderName, 120).trim(),
    replyTo: EMAIL.test(replyTo) ? replyTo : '',
    alliberat: template('alliberat'),
    pati: template('pati'),
  };
}

// Omple {camp} amb el valor corresponent. Un camp desconegut es deixa tal com és
// perquè es vegi a la previsualització.
export function renderMailTemplate(template, fields = {}) {
  return String(template || '').replace(/\{([a-z_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(fields, key) ? String(fields[key] ?? '') : match
  ));
}

// Minuts des de mitjanit de «8:00»; el pati és a les 10:45.
function noticeMinutes(notice) {
  const value = notice.kind === 'pati' ? '10:45' : String(notice.fields?.horari || '');
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60;
}

const paragraphs = (value) => String(value || '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

// Correu d'un professor per a un dia. notices: [{ kind, fields }]. Amb un sol avís, és la
// seva plantilla tal qual. Amb més d'un, els paràgrafs que tots els textos tenen igual al
// principi (salutació) i al final (comiat) hi surten una sola vegada, i al mig hi van els
// de cada avís per ordre d'hora.
export function composeMail(config, notices) {
  const ordered = [...notices]
    .filter((notice) => config[notice.kind])
    .sort((a, b) => noticeMinutes(a) - noticeMinutes(b));
  if (!ordered.length) return null;
  const rendered = ordered.map((notice) => ({
    subject: renderMailTemplate(config[notice.kind].subject, notice.fields || {}).trim(),
    parts: paragraphs(renderMailTemplate(config[notice.kind].body, notice.fields || {})),
  })).filter((mail, index, all) => all.findIndex((other) => other.parts.join('\n') === mail.parts.join('\n')) === index);
  if (rendered.length === 1) return { subject: rendered[0].subject, text: rendered[0].parts.join('\n\n') };
  const shortest = Math.min(...rendered.map(({ parts }) => parts.length));
  const same = (index) => rendered.every(({ parts }) => parts[index] === rendered[0].parts[index]);
  let head = 0;
  while (head < shortest - 1 && same(head)) head += 1;
  let tail = 0;
  const fromEnd = (parts, index) => parts[parts.length - 1 - index];
  while (head + tail < shortest - 1 && rendered.every(({ parts }) => fromEnd(parts, tail) === fromEnd(rendered[0].parts, tail))) tail += 1;
  const first = rendered[0].parts;
  const text = [
    ...first.slice(0, head),
    ...rendered.flatMap(({ parts }) => parts.slice(head, parts.length - tail)),
    ...first.slice(first.length - tail),
  ].join('\n\n');
  return { subject: renderMailTemplate(MAIL_COMBINED_SUBJECT, ordered[0].fields || {}).trim(), text };
}

function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

// Instant en què és «hh:mm» del dia indicat a la zona horària donada.
function zonedTime(year, month, day, minutes, timeZone) {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const shown = zonedParts(new Date(guess), timeZone);
  const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, Math.floor(shown.minutes / 60), shown.minutes % 60);
  return new Date(guess - (shownUtc - guess));
}

const isoDay = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function mailToday(now = new Date(), timeZone = MAIL_TIME_ZONE) {
  return isoDay(zonedParts(now, timeZone));
}

// Les 8:00 del dia «aaaa-mm-dd».
export function mailDayStart(date, { timeZone = MAIL_TIME_ZONE, start } = MAIL_WINDOW) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  return zonedTime(year, month, day, start, timeZone);
}

// Quan pot sortir un correu de la cua: mai abans de les 8:00 del seu dia, encara que
// s'hagués programat abans (amb la regla antiga o des d'un altre dia).
export function mailDueAt(mail) {
  const sendAfter = new Date(mail?.sendAfter || 0).getTime();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mail?.date || ''))) return new Date(sendAfter);
  return new Date(Math.max(sendAfter, mailDayStart(mail.date).getTime()));
}

// date: dia de l'avís. Si és un altre dia, a les 8:00 d'aquell dia. Si és avui (o és una
// prova, sense dia): dins de l'horari, al cap de 5 minuts; abans de les 8:00, a les 8:00;
// després, a les 8:00 del següent dia feiner (i el servei el descarta perquè el dia ja
// ha passat).
export function mailSendAfter(now = new Date(), date = '', { timeZone = MAIL_TIME_ZONE, start, end, delayMinutes } = MAIL_WINDOW) {
  const local = zonedParts(now, timeZone);
  if (date && date > isoDay(local)) return mailDayStart(date, { timeZone, start });
  const weekday = local.weekday >= 1 && local.weekday <= 5;
  if (weekday && local.minutes >= start && local.minutes <= end) {
    return new Date(now.getTime() + delayMinutes * 60 * 1000);
  }
  // Les 8:00 d'avui (si encara no ho són) o del següent dia feiner.
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (!weekday || local.minutes >= start) day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), start, timeZone);
}

const PARTICLES = new Set(['de', 'del', 'dels', 'la', 'les', 'el', 'els', 'i', 'y']);

function titleCase(value) {
  return String(value || '').toLocaleLowerCase('ca').split(/(\s+|-)/).map((word, index) => {
    if (!word.trim() || word === '-') return word;
    if (index > 0 && PARTICLES.has(word)) return word;
    const apostrophe = word.match(/^([dl]')(.+)$/);
    if (apostrophe) return `${apostrophe[1]}${apostrophe[2].charAt(0).toLocaleUpperCase('ca')}${apostrophe[2].slice(1)}`;
    return word.charAt(0).toLocaleUpperCase('ca') + word.slice(1);
  }).join('');
}

// «LLINATGES, NOM» (com al GPU004 i a Professorat) -> { nom: «Nom», nom_complet: «Nom Llinatges» }.
export function mailPersonNames(fullName) {
  const value = String(fullName || '').replace(/\s+/g, ' ').trim();
  if (!value) return { nom: '', nom_complet: '' };
  const [surnames, name] = value.includes(',') ? value.split(',').map((part) => part.trim()) : ['', value];
  const nom = titleCase(name || surnames);
  return { nom, nom_complet: [nom, surnames && name ? titleCase(surnames) : ''].filter(Boolean).join(' ') };
}

const WEEKDAY_NAMES = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];

export function mailDateFields(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (!year || !month || !day) return { data: '', dia: '' };
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    data: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    dia: WEEKDAY_NAMES[weekday],
  };
}

// «4a hora» a partir de l'hora d'inici i de les hores lectives del dia (sense el pati).
export function mailHourFields(hora, dayHours = []) {
  if (hora === 'PATI') return { hora: 'l\'hora del pati', horari: '10:45' };
  const index = dayHours.filter((value) => value !== 'PATI').indexOf(hora);
  return { hora: index >= 0 ? `${index + 1}a hora` : String(hora || ''), horari: String(hora || '') };
}

// Identificador estable de cada correu: tornar a desar el mateix canvi no el duplica.
export function mailId(parts) {
  return parts.map((part) => String(part ?? '').replace(/[^A-Za-z0-9_-]+/g, '-')).join('_').slice(0, 400);
}

// Assignacions noves com a alliberat/da entre dues jornades desades (o una de no desada).
export function newReleasedAssignments(previous, next) {
  const before = previous?.assignments || {};
  const wasCancelled = new Set(previous?.cancelledAssignments || []);
  const cancelled = new Set(next?.cancelledAssignments || []);
  return Object.entries(next?.assignments || {})
    .filter(([absenceId, assignment]) => assignment?.source === 'released' && assignment.teacherId && !cancelled.has(absenceId))
    .filter(([absenceId, assignment]) => {
      const old = before[absenceId];
      return !(old?.source === 'released' && old.teacherId === assignment.teacherId && !wasCancelled.has(absenceId));
    })
    .map(([absenceId, assignment]) => ({ absenceId, teacherId: assignment.teacherId }));
}
