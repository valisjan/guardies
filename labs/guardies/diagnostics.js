import {
  getGuardiesContext,
  loadGuardiesData,
  loadGuardiesDay,
  loadGuardiesTeacherDirectory,
  loadUnclosedGuardiesDays,
  signInGuardies,
} from '../../src/services/guardiesStorage.js';
import '../../src/utils/diagnostics.js';

const params = new URLSearchParams(window.location.search);
const requestedCourse = params.get('curs') || '';
const dateInput = document.querySelector('#diagnostic-date');
const stateNode = document.querySelector('#diagnostic-state');
const courseName = document.querySelector('#course-name');
const contextDetail = document.querySelector('#context-detail');
const signInButton = document.querySelector('#sign-in');
const resetButton = document.querySelector('#reset-diagnostics');
const actionButtons = [...document.querySelectorAll('[data-action]')];

let context = null;
let busy = false;

dateInput.value = validDate(params.get('data')) ? params.get('data') : localDate();
document.querySelector('#open-guardies').href = guardiesUrl();

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function guardiesUrl() {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('diagnostic', 'reads');
  if (context?.course?.id) url.searchParams.set('curs', context.course.id);
  if (validDate(dateInput.value)) url.searchParams.set('data', dateInput.value);
  return `${url.pathname}${url.search}`;
}

function setStatus(text, tone = '') {
  stateNode.textContent = text;
  stateNode.dataset.tone = tone;
}

function setBusy(value) {
  busy = value;
  [...actionButtons, resetButton, signInButton].forEach((button) => { button.disabled = value; });
}

async function loadContext() {
  setStatus('Connectant…');
  try {
    context = await getGuardiesContext(requestedCourse);
    courseName.textContent = context.course.name;
    contextDetail.textContent = `${context.user.displayName || context.user.email || 'Usuari'} · ${context.canWrite ? 'administració' : 'professorat'} · curs ${context.course.id}`;
    signInButton.hidden = true;
    setStatus('Preparat', 'ok');
  } catch (error) {
    context = null;
    courseName.textContent = 'Sessió necessària';
    contextDetail.textContent = error?.message || String(error);
    signInButton.hidden = false;
    setStatus('Sense sessió', 'warning');
  }
  document.querySelector('#open-guardies').href = guardiesUrl();
}

async function runAction(action) {
  if (busy) return;
  if (!context) {
    await loadContext();
    if (!context) return;
  }
  setBusy(true);
  setStatus('Mesurant…');
  try {
    const courseId = context.course.id;
    let detail = '';
    if (action === 'config') {
      await loadGuardiesData(courseId);
      detail = 'Configuració carregada.';
    } else if (action === 'day') {
      await loadGuardiesDay(courseId, dateInput.value, { publishedOnly: !context.canWrite });
      detail = `Jornada ${dateInput.value} carregada.`;
    } else if (action === 'directory') {
      const directory = await loadGuardiesTeacherDirectory(courseId);
      detail = `${directory.length} professors carregats.`;
    } else if (action === 'unclosed') {
      const dates = await loadUnclosedGuardiesDays(courseId, dateInput.value);
      detail = `${dates.length} jornades pendents trobades.`;
    }
    setStatus(detail, 'ok');
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
  } finally {
    setBusy(false);
    renderDiagnostics();
  }
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('ca-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp);
}

function renderDiagnostics() {
  const diagnostics = window.__guardiesDiagnostics;
  if (!diagnostics) return;
  const categories = new Set([...Object.keys(diagnostics.network), ...Object.keys(diagnostics.cache)]);
  const rows = [...categories]
    .map((category) => ({
      category,
      network: diagnostics.network[category] || 0,
      cache: diagnostics.cache[category] || 0,
      calls: diagnostics.calls[category] || 0,
    }))
    .sort((a, b) => b.network - a.network);
  document.querySelector('#total-network').textContent = diagnostics.totalNetwork;
  document.querySelector('#total-cache').textContent = diagnostics.totalCache;
  document.querySelector('#total-calls').textContent = Object.values(diagnostics.calls).reduce((sum, count) => sum + count, 0);
  document.querySelector('#last-updated').textContent = rows.length ? `Actualitzat a les ${formatTime(Date.now())}` : 'Encara sense lectures';
  document.querySelector('#diagnostics-rows').innerHTML = rows.length
    ? rows.map((row) => `<tr><th scope="row">${row.category}</th><td>${row.network}</td><td>${row.cache}</td><td>${row.calls}</td></tr>`).join('')
    : '<tr><td colspan="4">Encara no hi ha dades.</td></tr>';
  const recent = diagnostics.log.slice(-12).reverse();
  document.querySelector('#diagnostics-log').innerHTML = recent.length
    ? recent.map((entry) => `<li><time>${formatTime(entry.ts)}</time><strong>${entry.category}</strong><span>+${entry.reads} ${entry.fromCache ? 'memòria cau' : 'xarxa'}${entry.note ? ` · ${entry.note}` : ''}</span></li>`).join('')
    : '<li>Encara no hi ha cap operació registrada.</li>';
}

signInButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    const signedIn = await signInGuardies();
    if (signedIn) await loadContext();
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
});

resetButton.addEventListener('click', () => {
  window.__guardiesDiagnostics?.reset();
  setStatus('Comptador reiniciat.', 'ok');
  renderDiagnostics();
});

actionButtons.forEach((button) => button.addEventListener('click', () => runAction(button.dataset.action)));
dateInput.addEventListener('change', () => { document.querySelector('#open-guardies').href = guardiesUrl(); });

window.setInterval(renderDiagnostics, 500);
renderDiagnostics();
loadContext();
