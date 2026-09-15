import * as parser from './horariXmlParser.js';
import { GUARD_CODES_STORAGE, useGuardiesStore } from './stores/guardies.js';
import {
  classroomPartnerForAbsence,
  completeGuardDutyHours,
  dateForXmlDayInSameWeek,
  groupTeachingBlocks,
  isTeacherAbsentAtSlot,
  mergeSharedClassroomAbsences,
  releasedTeachingBlocks,
  xmlDayForDate,
} from '../../src/modules/guardies/domain/day.js';
import { guardCountForSlot, normalizeGuardCount, teachingDatesBetween } from '../../src/modules/guardies/domain/workflow.js';
import {
  nonTeachingReason,
  patioAssignmentsForDate,
} from '../../src/modules/guardies/domain/patio.js';
import {
  deleteGuardiesFile,
  getGuardiesContext,
  loadGuardiesData,
  loadGuardiesDay,
  loadGuardiesStats,
  loadGuardiesTeacherDirectory,
  loadUnclosedGuardiesDays,
  mergeGuardiesDayPlan,
  saveGuardiesDay,
  saveGuardiesConvivencia,
  saveGuardiesFile,
  saveGuardiesPati,
  subscribeGuardiesData,
  subscribeGuardiesDay,
  transitionGuardiesDay,
} from '../../src/services/guardiesStorage';
import { savePublicGuardiesDay } from '../../src/services/pantallesStorage.js';

(function initGuardiesLab() {
  const PATI_COMMENT_KEY = '__pati_observation__';
  const LEGACY_STORAGE = {
    referenceXml: 'quota_guardies_lab_reference_xml',
    referenceName: 'quota_guardies_lab_reference_name',
    untisText: 'quota_guardies_lab_untis_professorat_text',
    untisName: 'quota_guardies_lab_untis_professorat_name',
    scheduleXml: 'quota_guardies_lab_schedule_xml',
    scheduleName: 'quota_guardies_lab_schedule_name',
    convivencia: 'quota_guardies_lab_convivencia',
  };
  const state = useGuardiesStore();
  let daySaveTimer = null;
  let lastDaySignature = '';
  let lastRemoteDataSignature = '';
  let unsubscribeGuardiesData = () => {};
  let unsubscribeGuardiesDay = () => {};
  let watchedDate = '';
  let pendingRemoteDay = null;
  let teacherAliasesById = new Map();
  let professorResultIndex = -1;

  const el = {
    error: document.getElementById('error-box'),
    empty: document.getElementById('empty-state'),
    workspace: document.getElementById('workspace'),
    statSessions: document.getElementById('stat-sessions'),
    statProfessors: document.getElementById('stat-professors'),
    statGrups: document.getElementById('stat-grups'),
    statActivitats: document.getElementById('stat-activitats'),
    statReference: document.getElementById('stat-reference'),
    professorSelect: document.getElementById('professor-select'),
    professorSearch: document.getElementById('professor-search'),
    professorResults: document.getElementById('professor-results'),
    selectedProfessorLabel: document.getElementById('selected-professor-label'),
    scheduleTitle: document.getElementById('schedule-title'),
    addAllHours: document.getElementById('add-all-hours'),
    clearMissing: document.getElementById('clear-missing'),
    printDateLabel: document.getElementById('print-date-label'),
    scheduleGrid: document.getElementById('schedule-grid'),
    coverageList: document.getElementById('coverage-list'),
    publicOutingList: document.getElementById('public-outing-list'),
    groupSearch: document.getElementById('group-search'),
    selectedGroups: document.getElementById('selected-groups'),
    releasedCount: document.getElementById('released-count'),
    releasedList: document.getElementById('released-list'),
    clearGroups: document.getElementById('clear-groups'),
  };

  window.addEventListener('guardies:upload-file', (event) => {
    onUploadFile(event.detail?.file, event.detail?.kind);
  });
  window.addEventListener('guardies:remove-file', (event) => {
    removeUploadedFile(event.detail?.kind);
  });
  window.addEventListener('guardies:clear-files', clearPersistentFiles);
  window.addEventListener('guardies:auth-changed', bootstrap);
  window.addEventListener('guardies:pati-updated', () => renderCoverage());
  window.addEventListener('guardies:exclusions-updated', async () => {
    parseStoredData({ resetSelection: false });
    await activateGuardiesDay(state.date);
    render();
  });
  window.addEventListener('guardies:day-action', (event) => changeDayStatus(event.detail?.action));
  window.addEventListener('guardies:auto-assign', autoAssignCoverage);
  window.addEventListener('guardies:apply-absence-range', (event) => applyAbsenceRange(event.detail));
  window.addEventListener('guardies:apply-outing-range', (event) => applyOutingRange(event.detail));
  el.professorSelect.addEventListener('change', () => {
    selectProfessor(el.professorSelect.value);
  });
  el.professorSearch.addEventListener('input', () => {
    professorResultIndex = 0;
    renderProfessorResults(el.professorSearch.value);
  });
  el.professorSearch.addEventListener('keydown', (event) => {
    const buttons = Array.from(el.professorResults.querySelectorAll('[data-professor]'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!buttons.length) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      professorResultIndex = (professorResultIndex + direction + buttons.length) % buttons.length;
      highlightProfessorResult(buttons);
      return;
    }
    if (event.key === 'Enter') {
      const selected = buttons[professorResultIndex] || buttons[0];
      if (!selected) return;
      event.preventDefault();
      selectProfessor(selected.dataset.professor);
      return;
    }
    if (event.key === 'Escape') {
      professorResultIndex = -1;
      el.professorResults.innerHTML = '';
      el.professorSearch.setAttribute('aria-expanded', 'false');
    }
  });
  el.professorSearch.addEventListener('focus', () => {
    if (el.professorSearch.value === labelProfessor(state.professor)) {
      el.professorSearch.value = '';
    }
    renderProfessorResults(el.professorSearch.value);
  });
  el.addAllHours.addEventListener('click', () => {
    if (state.dayStatus === 'closed') return;
    addAllCurrentProfessorAbsences();
    render();
  });
  el.clearMissing.addEventListener('click', () => {
    if (state.dayStatus === 'closed') return;
    clearCurrentProfessorAbsences();
    render();
  });
  el.groupSearch.addEventListener('change', () => {
    const codi = el.groupSearch.value;
    if (codi) addGroupOut(codi);
  });
  el.clearGroups.addEventListener('click', () => {
    if (!state.canWrite || state.dayStatus === 'closed') return;
    state.grupsFora.clear();
    state.grupProfessorsFora.clear();
    state.grupProfessorsAlliberats.clear();
    state.partialGroups.clear();
    state.outingAbsenceIds.forEach((id) => state.absencies.delete(id));
    state.outingAbsenceIds.clear();
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
  });

  setupIntakeAccordion();
  window.addEventListener('guardies:legacy-render', async (event) => {
    if (event.detail?.reloadDay) await activateGuardiesDay(state.date);
    render();
  });
  window.addEventListener('beforeunload', () => {
    unsubscribeGuardiesData();
    unsubscribeGuardiesDay();
  });
  bootstrap();

  async function bootstrap() {
    unsubscribeGuardiesData();
    unsubscribeGuardiesDay();
    state.contextReady = false;
    state.authRequired = false;
    state.persistenceStatus = 'loading';
    const search = new URLSearchParams(window.location.search);
    state.teacherView = search.get('vista') === 'professor';
    render();
    try {
      const requestedCourseId = search.get('curs') || '';
      const requestedDate = search.get('data') || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) state.changeDate(requestedDate);
      const context = await getGuardiesContext(requestedCourseId, {
        teacherView: search.get('vista') === 'professor',
      });
      state.courseId = context.course.id;
      state.courseName = context.course.name;
      state.canWrite = context.canWrite;
      state.isAdmin = context.isAdmin;
      state.teacherView = context.teacherView;
      state.viewerName = context.user?.displayName || '';
      state.viewerEmail = context.user?.email || '';
      state.authRequired = false;
      let remoteData = await loadGuardiesData(state.courseId);
      remoteData = await migrateLegacyData(remoteData);
      applyRemoteData(remoteData);
      const [teacherDirectory, stats, unclosedDays] = await Promise.all([
        loadGuardiesTeacherDirectory(state.courseId).catch(() => []),
        loadGuardiesStats(state.courseId),
        state.canWrite
          ? loadUnclosedGuardiesDays(state.courseId, localDateString(new Date())).catch(() => [])
          : Promise.resolve([]),
      ]);
      state.teacherDirectory = teacherDirectory;
      state.unclosedDays = unclosedDays;
      state.guardCounts = new Map(Object.entries(stats.counts || {}));
      lastRemoteDataSignature = remoteDataSignature({ ...remoteData, stats });
      state.persistenceStatus = 'ready';
      const adminPanel = document.getElementById('admin-panel');
      if (adminPanel) adminPanel.open = false;
      parseStoredData({ resetSelection: true });
      await activateGuardiesDay(state.date);
      subscribeToRemoteData();
      state.contextReady = true;
      render();
      window.dispatchEvent(new CustomEvent('guardies:auth-ready'));
    } catch (error) {
      state.persistenceStatus = 'error';
      state.contextReady = true;
      state.authRequired = String(error?.message || error).includes('Inicia sessió');
      showError(state.authRequired ? '' : error.message || String(error));
      render();
      window.dispatchEvent(new CustomEvent('guardies:auth-ready'));
    }
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function convivenciaFromObject(raw = {}) {
    return new Map(Object.entries(raw)
      .map(([key, values]) => [key, new Set(Array.isArray(values) ? values.filter(Boolean) : [])]));
  }

  function storageGet(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      showError(`No s'ha pogut guardar la preferència local. ${error.message || error}`);
      return false;
    }
  }

  function storageRemove(keys) {
    keys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignorem errors de neteja local: la pantalla es torna a renderitzar igualment.
      }
    });
  }

  function legacyData() {
    return {
      files: {
        reference: {
          text: storageGet(LEGACY_STORAGE.referenceXml, ''),
          name: storageGet(LEGACY_STORAGE.referenceName, ''),
        },
        untis: {
          text: storageGet(LEGACY_STORAGE.untisText, ''),
          name: storageGet(LEGACY_STORAGE.untisName, ''),
        },
      },
      convivencia: loadJson(LEGACY_STORAGE.convivencia, {}),
    };
  }

  async function migrateLegacyData(remoteData) {
    const legacy = legacyData();
    const hasLegacyFiles = Object.values(legacy.files).some((file) => file.text);
    const hasLegacyConvivencia = Object.keys(legacy.convivencia).length > 0;
    if (!state.canWrite || (!hasLegacyFiles && !hasLegacyConvivencia)) return remoteData;

    state.persistenceStatus = 'saving';
    for (const kind of ['reference', 'untis']) {
      const legacyFile = legacy.files[kind];
      if (!remoteData.files[kind] && legacyFile.text) {
        await saveGuardiesFile(state.courseId, kind, legacyFile.text, legacyFile.name);
      }
    }
    if (!Object.keys(remoteData.convivencia || {}).length && hasLegacyConvivencia) {
      await saveGuardiesConvivencia(state.courseId, legacy.convivencia);
    }
    storageRemove(Object.values(LEGACY_STORAGE));
    return loadGuardiesData(state.courseId);
  }

  function applyRemoteData(remoteData) {
    const reference = remoteData.files.reference;
    const untis = remoteData.files.untis;
    state.referenceText = reference?.text || '';
    state.referenceName = reference?.name || '';
    state.untisText = untis?.text || '';
    state.untisName = untis?.name || '';
    state.dutiesText = remoteData.files.duties?.text || '';
    state.dutiesName = remoteData.files.duties?.name || '';
    state.convivencia = convivenciaFromObject(remoteData.convivencia);
    state.patiConfig = remoteData.pati || null;
    state.observationPresets = remoteData.observationPresets || [];
    state.excludedTeacherIds = new Set(remoteData.excludedTeacherIds || []);
  }

  function remoteDataSignature(remoteData) {
    return JSON.stringify({
      files: remoteData.files || {},
      convivencia: remoteData.convivencia || {},
      pati: remoteData.pati || null,
      observationPresets: remoteData.observationPresets || [],
      excludedTeacherIds: remoteData.excludedTeacherIds || [],
      counts: remoteData.stats?.counts || {},
    });
  }

  function subscribeToRemoteData() {
    unsubscribeGuardiesData();
    unsubscribeGuardiesData = subscribeGuardiesData(state.courseId, async (remoteData) => {
      const signature = remoteDataSignature(remoteData);
      if (signature === lastRemoteDataSignature) return;
      const previousFiles = JSON.stringify({
        reference: state.referenceText,
        untis: state.untisText,
        duties: state.dutiesText,
      });
      lastRemoteDataSignature = signature;
      applyRemoteData(remoteData);
      state.guardCounts = new Map(Object.entries(remoteData.stats?.counts || {}));
      const nextFiles = JSON.stringify({
        reference: state.referenceText,
        untis: state.untisText,
        duties: state.dutiesText,
      });
      parseStoredData({ resetSelection: false });
      if (previousFiles !== nextFiles && daySignature() === lastDaySignature) {
        await hydrateGuardiesDay(state.date);
      }
      state.persistenceStatus = 'ready';
      render();
    }, (error) => {
      if (error?.code === 'permission-denied') return;
      showError(`No s'han pogut sincronitzar les dades. ${error.message || error}`);
    });
  }

  function serializableDay() {
    const assignments = {};
    const comments = {};
    const groupTeachers = {};
    const groupReleasedTeachers = {};
    state.assignacions.forEach((teacherId, absenceId) => {
      assignments[absenceId] = {
        teacherId,
        source: state.assignmentSources.get(absenceId) || 'other',
      };
    });
    state.comentaris.forEach((comment, absenceId) => { comments[absenceId] = comment; });
    state.grupProfessorsFora.forEach((teachers, groupId) => {
      groupTeachers[groupId] = Array.from(teachers).filter(Boolean).sort();
    });
    state.grupProfessorsAlliberats.forEach((teachers, groupId) => {
      groupReleasedTeachers[groupId] = Array.from(teachers).filter(Boolean).sort();
    });
    return {
      status: state.dayStatus,
      absenceIds: Array.from(state.absencies.keys()).sort(),
      assignments,
      comments,
      groupsOut: Array.from(state.grupsFora).filter(Boolean).sort(),
      groupTeachers,
      groupReleasedTeachers,
      partialGroups: Array.from(state.partialGroups).sort(),
      outingAbsenceIds: Array.from(state.outingAbsenceIds).sort(),
      cancelledAssignments: Array.from(state.cancelledAssignments).sort(),
      publishedAt: state.publishedAt,
      closedAt: state.closedAt,
      countedAssignments: state.countedAssignments,
    };
  }

  function publicGuardiesDay() {
    const selected = selectedAbsenceItems();
    const coverageItems = mergeSharedClassroomAbsences({ sessions: state.sessions, absences: selected });
    consolidateMergedCoverageState(coverageItems);
    const byHour = new Map(groupBySession(coverageItems).map((group) => [group.hora, group.items]));
    const patioAssignments = state.patiConfig && !nonTeachingReason(state.date, state.patiConfig)
      ? patioAssignmentsForDate(state.date, state.patiConfig)
        .filter((assignment) => !isExcludedTeacher(assignment.teacherId))
      : [];
    const patioObservation = state.comentaris.get(PATI_COMMENT_KEY) || '';
    const day = diaXmlSeleccionat();
    const hours = hoursForSelectedDay().map((hour) => {
      if (hour === 'PATI') {
        return {
          key: 'PATI',
          kind: 'patio',
          label: horaLabel(hour),
          rows: [],
          patio: {
            zones: patioAssignments.map((assignment) => ({
              name: String(assignment.zoneName || ''),
              teacher: labelProfessor(assignment.teacherId, true),
              absent: isProfessorAbsentAtHour(day, 'PATI', assignment.teacherId),
            })),
            observation: patioObservation,
          },
        };
      }
      return {
        key: String(hour),
        kind: 'guardies',
        label: horaLabel(hour),
        rows: (byHour.get(hour) || []).map((item) => {
          const absentTeacherIds = item.absentTeacherIds?.length ? item.absentTeacherIds : [item.placa];
          const assignedId = state.assignacions.get(item.id) || '';
          const coTeacher = state.assignmentSources.get(item.id) === 'co-teacher';
          return {
            id: String(item.id || ''),
            absent: absentTeacherIds.map((teacherId) => labelProfessor(teacherId, true)).join(' · '),
            group: isGuardiaItem(item) ? 'Guàrdia' : (groupLabel(item) || ''),
            subject: formatMateria(item) || '',
            room: aulaLabel(item) || '',
            assigned: assignedId ? labelProfessor(assignedId, true) : '',
            coTeacher,
            cancelled: state.cancelledAssignments.has(item.id),
            comment: state.comentaris.get(item.id) || '',
          };
        }),
      };
    });
    const groupLabels = new Map(grupsOrdenatsAmbLabel().map((group) => [String(group.codi), group.label]));
    const groupsOut = Array.from(state.grupsFora)
      .map((groupId) => ({
        id: String(groupId),
        label: groupLabels.get(String(groupId)) || String(groupId),
        partial: state.partialGroups.has(groupId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));
    return {
      schemaVersion: 1,
      date: state.date,
      status: state.dayStatus,
      revision: state.dayRevision,
      publishedAt: state.publishedAt || '',
      clientUpdatedAt: state.updatedAt || new Date().toISOString(),
      hours,
      groupsOut,
    };
  }

  async function syncPublicGuardiesDay() {
    if (!state.isAdmin || !state.courseId || !state.date) return;
    const published = ['published', 'closed'].includes(state.dayStatus);
    await savePublicGuardiesDay(
      state.courseId,
      state.date,
      published ? publicGuardiesDay() : null,
    );
  }

  function daySignature(payload = serializableDay()) {
    return JSON.stringify(payload);
  }

  function applyGuardiesDay(saved, date) {
    if (date !== state.date) return;
    state.clearDayContext();
    const day = xmlDayForDate(date);
    const items = parser.agruparSessionsCobertura(
      state.sessions.filter((session) => session.dia === day && isMeaningfulSession(session)),
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    (saved?.absenceIds || []).forEach((id) => {
      const item = byId.get(id);
      if (item && isAbsenceSelectable(item)) state.absencies.set(id, item);
    });
    Object.entries(saved?.assignments || {}).forEach(([id, assignment]) => {
      const teacherId = typeof assignment === 'string' ? assignment : assignment?.teacherId;
      const source = typeof assignment === 'object' && ['released', 'guard', 'co-teacher'].includes(assignment?.source)
        ? assignment.source
        : 'other';
      if (state.absencies.has(id) && teacherId && !isExcludedTeacher(teacherId)) {
        state.assignacions.set(id, teacherId);
        state.assignmentSources.set(id, source);
      }
    });
    Object.entries(saved?.comments || {}).forEach(([id, comment]) => {
      if ((state.absencies.has(id) || id === PATI_COMMENT_KEY) && comment) state.comentaris.set(id, comment);
    });
    (saved?.groupsOut || []).forEach((groupId) => state.grupsFora.add(groupId));
    Object.entries(saved?.groupTeachers || {}).forEach(([groupId, teachers]) => {
      state.grupProfessorsFora.set(groupId, new Set(Array.isArray(teachers) ? teachers : []));
    });
    Object.entries(saved?.groupReleasedTeachers || {}).forEach(([groupId, teachers]) => {
      state.grupProfessorsAlliberats.set(groupId, new Set(Array.isArray(teachers) ? teachers : []));
    });
    state.partialGroups = new Set(saved?.partialGroups || []);
    state.outingAbsenceIds = new Set(saved?.outingAbsenceIds || []);
    if (saved && !Object.prototype.hasOwnProperty.call(saved, 'groupReleasedTeachers')) {
      state.grupsFora.forEach((groupId) => {
        state.grupProfessorsAlliberats.set(groupId, defaultReleasedGroupKeys(groupId));
      });
    }
    if (state.grupsFora.size) syncOutingAbsences();
    state.dayStatus = saved?.status || (state.canWrite ? 'draft' : 'unpublished');
    state.publishedAt = saved?.publishedAt || '';
    state.closedAt = saved?.closedAt || '';
    state.updatedAt = saved?.clientUpdatedAt || '';
    state.cancelledAssignments = new Set(saved?.cancelledAssignments || []);
    state.countedAssignments = Array.isArray(saved?.countedAssignments) ? saved.countedAssignments : [];
    state.dayRevision = Number(saved?.revision) || 0;
    lastDaySignature = daySignature();
    state.dayPersistenceStatus = 'ready';
    state.dayLoaded = true;
  }

  async function hydrateGuardiesDay(date) {
    if (!state.courseId || !date) return;
    state.dayLoaded = false;
    state.dayPersistenceStatus = 'loading';
    state.clearDayContext();
    render();
    try {
      const saved = await loadGuardiesDay(state.courseId, date, {
        publishedOnly: state.teacherView || !state.isAdmin,
      });
      if (date !== state.date) return;
      applyGuardiesDay(saved, date);
    } catch (error) {
      state.dayPersistenceStatus = 'error';
      showError(`No s'ha pogut carregar la jornada. ${error.message || error}`);
    } finally {
      if (date === state.date) state.dayLoaded = true;
    }
  }

  async function activateGuardiesDay(date) {
    unsubscribeGuardiesDay();
    watchedDate = date;
    pendingRemoteDay = null;
    await hydrateGuardiesDay(date);
    if (date !== state.date || date !== watchedDate) return;
    if (state.isAdmin && ['published', 'closed'].includes(state.dayStatus)) {
      syncPublicGuardiesDay().catch(() => {});
    }
    unsubscribeGuardiesDay = subscribeGuardiesDay(state.courseId, date, (saved) => {
      if (date !== state.date || date !== watchedDate || !state.dayLoaded) return;
      const remoteRevision = Number(saved?.revision) || 0;
      const isDeletion = !saved;
      if ((!isDeletion && remoteRevision <= state.dayRevision) || (isDeletion && state.dayRevision === 0)) return;
      if (state.dayPersistenceStatus === 'saving' || daySignature() !== lastDaySignature) {
        pendingRemoteDay = { saved, date };
        return;
      }
      applyGuardiesDay(saved, date);
      showError('');
      render();
    }, (error) => {
      if (error?.code === 'permission-denied') return;
      showError(`No s'ha pogut sincronitzar la jornada. ${error.message || error}`);
    }, { publishedOnly: state.teacherView || !state.isAdmin });
  }

  function flushPendingRemoteDay() {
    if (!pendingRemoteDay || pendingRemoteDay.date !== state.date) return false;
    const { saved, date } = pendingRemoteDay;
    pendingRemoteDay = null;
    const remoteRevision = Number(saved?.revision) || 0;
    if ((saved && remoteRevision <= state.dayRevision) || (!saved && state.dayRevision === 0)) return false;
    applyGuardiesDay(saved, date);
    render();
    return true;
  }

  function scheduleDaySave() {
    if (!state.canWrite || !state.courseId || !state.date || !state.dayLoaded || state.dayStatus === 'closed') return;
    const payload = serializableDay();
    const signature = daySignature(payload);
    if (signature === lastDaySignature) return;
    clearTimeout(daySaveTimer);
    daySaveTimer = setTimeout(async () => {
      try {
        state.dayPersistenceStatus = 'saving';
        const saved = await saveGuardiesDay(state.courseId, state.date, payload, state.dayRevision);
        state.dayRevision = saved.revision;
        state.updatedAt = saved.clientUpdatedAt || new Date().toISOString();
        lastDaySignature = signature;
        state.dayPersistenceStatus = 'ready';
        if (['published', 'closed'].includes(state.dayStatus)) await syncPublicGuardiesDay();
        flushPendingRemoteDay();
      } catch (error) {
        state.dayPersistenceStatus = 'error';
        const synchronized = flushPendingRemoteDay();
        showError(synchronized
          ? 'La jornada havia canviat en una altra sessió i s\'ha sincronitzat. Revisa el teu darrer canvi.'
          : `No s'ha pogut guardar la jornada. ${error.message || error}`);
      }
    }, 250);
  }

  async function persistDayNow() {
    clearTimeout(daySaveTimer);
    const payload = serializableDay();
    const signature = daySignature(payload);
    if (signature === lastDaySignature) return;
    state.dayPersistenceStatus = 'saving';
    const saved = await saveGuardiesDay(state.courseId, state.date, payload, state.dayRevision);
    state.dayRevision = saved.revision;
    state.updatedAt = saved.clientUpdatedAt || new Date().toISOString();
    lastDaySignature = signature;
    state.dayPersistenceStatus = 'ready';
    if (['published', 'closed'].includes(state.dayStatus)) await syncPublicGuardiesDay();
    flushPendingRemoteDay();
  }

  async function changeDayStatus(action) {
    if (!state.canWrite || !['publish', 'unpublish', 'close', 'reopen'].includes(action)) return;
    try {
      state.dayPersistenceStatus = 'saving';
      await persistDayNow();
      const result = await transitionGuardiesDay(state.courseId, state.date, action);
      state.dayStatus = result.day.status;
      state.publishedAt = result.day.publishedAt || '';
      state.closedAt = result.day.closedAt || '';
      state.updatedAt = result.day.clientUpdatedAt || new Date().toISOString();
      state.dayRevision = Number(result.day.revision) || state.dayRevision + 1;
      state.countedAssignments = Array.isArray(result.day.countedAssignments)
        ? result.day.countedAssignments
        : state.countedAssignments;
      state.guardCounts = new Map(Object.entries(result.stats?.counts || Object.fromEntries(state.guardCounts)));
      await syncPublicGuardiesDay();
      state.unclosedDays = await loadUnclosedGuardiesDays(
        state.courseId,
        localDateString(new Date()),
      ).catch(() => state.unclosedDays);
      lastDaySignature = daySignature();
      state.dayPersistenceStatus = 'ready';
      flushPendingRemoteDay();
      showError('');
      render();
    } catch (error) {
      state.dayPersistenceStatus = 'error';
      showError(`No s'ha pogut canviar l'estat de la jornada. ${error.message || error}`);
    }
  }

  function datesBetween(from, to) {
    return teachingDatesBetween(from, to);
  }

  async function applyAbsenceRange({ from, to } = {}) {
    const reportResult = (ok, message, count = 0) => {
      window.dispatchEvent(new CustomEvent('guardies:absence-range-result', {
        detail: { ok, message, count },
      }));
    };
    if (!state.canWrite || !state.professor || state.dayStatus === 'closed') {
      reportResult(false, 'Selecciona primer el professor absent.');
      return;
    }
    const currentItems = currentProfessorDayItems().filter(isAbsenceSelectable);
    const selectedItems = currentItems.filter((item) => state.absencies.has(item.id));
    const selectedHours = new Set(selectedItems.map((item) => item.hora));
    if (!selectedItems.length) {
      const message = 'Marca primer les sessions de l’absència que vols replicar.';
      showError(message);
      reportResult(false, message);
      return;
    }
    const dates = datesBetween(from, to);
    if (!dates.length) {
      const message = 'L’interval no conté cap dia lectiu vàlid.';
      showError(message);
      reportResult(false, message);
      return;
    }
    const wholeDay = currentItems.length > 0 && selectedItems.length === currentItems.length;
    const plans = dates.map((date) => {
      const day = xmlDayForDate(date);
      const dayItems = parser.agruparSessionsCobertura(
        state.sessions.filter((session) => session.placa === state.professor && session.dia === day && isMeaningfulSession(session)),
      ).filter(isAbsenceSelectable);
      const ids = (wholeDay ? dayItems : dayItems.filter((item) => selectedHours.has(item.hora))).map((item) => item.id);
      return { date, ids };
    });
    try {
      state.dayPersistenceStatus = 'saving';
      await persistDayNow();
      await Promise.all(plans
        .filter(({ date }) => date !== state.date)
        .map(({ date, ids }) => mergeGuardiesDayPlan(state.courseId, date, { absenceIds: ids })));
      await hydrateGuardiesDay(state.date);
      state.dayPersistenceStatus = 'ready';
      showError('');
      const sessions = plans.reduce((total, plan) => total + plan.ids.length, 0);
      const message = wholeDay
        ? `Totes les hores aplicades a ${dates.length} ${dates.length === 1 ? 'dia lectiu' : 'dies lectius'} · ${sessions} ${sessions === 1 ? 'sessió' : 'sessions'}.`
        : `Sessions marcades aplicades a ${dates.length} ${dates.length === 1 ? 'dia lectiu' : 'dies lectius'} · ${sessions} ${sessions === 1 ? 'sessió' : 'sessions'}.`;
      reportResult(true, message, sessions);
      render();
    } catch (error) {
      state.dayPersistenceStatus = 'error';
      const message = `No s'ha pogut aplicar l'interval. ${error.message || error}`;
      showError(message);
      reportResult(false, message);
    }
  }

  async function applyOutingRange({ from, to } = {}) {
    const reportResult = (ok, message, count = 0) => {
      window.dispatchEvent(new CustomEvent('guardies:outing-range-result', {
        detail: { ok, message, count },
      }));
    };
    if (!state.canWrite || !state.grupsFora.size || state.dayStatus === 'closed') {
      reportResult(false, 'Selecciona almenys un grup abans de copiar la sortida.');
      return;
    }
    const dates = datesBetween(from, to).filter((date) => date !== state.date);
    if (!dates.length) {
      const message = 'Tria un interval que inclogui almenys un altre dia lectiu.';
      showError(message);
      reportResult(false, message);
      return;
    }
    const groupTeachers = {};
    const groupReleasedTeachers = {};
    state.grupProfessorsFora.forEach((teachers, groupId) => {
      groupTeachers[groupId] = Array.from(teachers);
    });
    state.grupProfessorsAlliberats.forEach((teachers, groupId) => {
      groupReleasedTeachers[groupId] = Array.from(teachers);
    });
    try {
      state.dayPersistenceStatus = 'saving';
      await Promise.all(dates.map((date) => mergeGuardiesDayPlan(state.courseId, date, {
        groupsOut: Array.from(state.grupsFora), groupTeachers, groupReleasedTeachers,
        partialGroups: Array.from(state.partialGroups),
        completeGroups: Array.from(state.grupsFora).filter((groupId) => !state.partialGroups.has(groupId)),
      })));
      await hydrateGuardiesDay(state.date);
      state.dayPersistenceStatus = 'ready';
      showError('');
      reportResult(true, `Sortida copiada a ${dates.length} ${dates.length === 1 ? 'dia lectiu' : 'dies lectius'}.`, dates.length);
      render();
    } catch (error) {
      state.dayPersistenceStatus = 'error';
      const message = `No s'ha pogut copiar la sortida. ${error.message || error}`;
      showError(message);
      reportResult(false, message);
    }
  }

  function setupIntakeAccordion() {
    const adminPanel = document.getElementById('admin-panel');
    const todayInfo = document.getElementById('today-info');
    const modeButtons = Array.from(document.querySelectorAll('[data-intake-mode]'));
    const modePanels = Array.from(document.querySelectorAll('[data-mode-panel]'));
    const clearConvivencia = document.getElementById('clear-convivencia');

    if (adminPanel) adminPanel.open = false;
    if (todayInfo) {
      const label = todayInfo.querySelector('strong');
      if (label) label.textContent = formatData(localDateString(new Date()));
    }

    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.intakeMode;
        modeButtons.forEach((item) => {
          const active = item.dataset.intakeMode === mode;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        modePanels.forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.modePanel !== mode);
        });
      });
    });

    el.convivenciaAdminList = document.getElementById('convivencia-admin-list');
    el.clearConvivencia = clearConvivencia;
    clearConvivencia?.addEventListener('click', async () => {
      if (!state.canWrite) return;
      state.convivencia.clear();
      await saveConvivencia();
    });
  }

  function saveGuardCodes() {
    storageSet(GUARD_CODES_STORAGE, JSON.stringify(Array.from(state.guardiaCodes)));
  }

  async function saveConvivencia() {
    if (!state.canWrite || !state.courseId) return;
    const serializable = {};
    state.convivencia.forEach((professors, key) => {
      const values = Array.from(professors).filter(Boolean);
      serializable[key] = values;
    });
    try {
      state.persistenceStatus = 'saving';
      await saveGuardiesConvivencia(state.courseId, serializable);
      state.persistenceStatus = 'ready';
      showError('');
    } catch (error) {
      state.persistenceStatus = 'error';
      showError(`No s'ha pogut guardar la setmana. ${error.message || error}`);
    }
    render();
  }

  function showError(message) {
    el.error.textContent = message || '';
    el.error.classList.toggle('hidden', !message);
  }

  async function readXmlFileText(file) {
    const buffer = await file.arrayBuffer();
    const header = new TextDecoder('windows-1252').decode(buffer.slice(0, 300));
    const declared = (header.match(/encoding=["']([^"']+)/i)?.[1] || '').toLowerCase();
    const encoding = declared.includes('iso-8859-1') || declared.includes('windows-1252')
      ? 'windows-1252'
      : 'utf-8';

    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }

  async function onUploadFile(file, intendedKind) {
    if (!file) return;

    try {
      if (!state.canWrite) throw new Error('Només un usuari administrador pot substituir els fitxers.');
      showError('');
      const text = await readXmlFileText(file);
      const detectedKind = detectUploadKind(text, intendedKind);
      if (xmlRootName(text) === 'DOCUMENT') {
        throw new Error('Aquest XML complet d\'Untis no és necessari. Exporta i carrega GPU001.TXT.');
      }
      if (detectedKind !== intendedKind) {
        const labels = {
          reference: 'XML de GestIB',
          untis: 'GPU004 de professorat',
          duties: 'GPU001 d\'horari i guàrdies',
        };
        throw new Error(`Aquest fitxer no correspon al pas actual. S'espera: ${labels[intendedKind]}.`);
      }
      await saveUploadedFile(detectedKind, text, file.name);
      parseStoredData({ resetSelection: detectedKind === 'duties' });
    } catch (error) {
      state.persistenceStatus = 'error';
      showError(error.message || String(error));
      render();
    }
  }

  function detectUploadKind(text, fallback) {
    const root = xmlRootName(text);
    if (root === 'HORARI' || root === 'DOCUMENT') return 'schedule';
    if (root === 'CENTRE') return 'reference';
    if (!root) return fallback;
    return fallback;
  }

  function xmlRootName(text) {
    let net = String(text || '').replace(/^\uFEFF/, '').trim();
    net = net.replace(/^<\?xml[^>]*>\s*/i, '');
    net = net.replace(/^(?:<!--[\s\S]*?-->\s*)+/g, '');
    const match = net.match(/^<([A-Za-z_][\w:.-]*)\b/);
    return (match?.[1] || '').split(':').pop().toUpperCase();
  }

  async function saveUploadedFile(kind, text, name) {
    state.persistenceStatus = 'saving';
    const file = await saveGuardiesFile(state.courseId, kind, text, name);
    if (kind === 'reference') {
      state.referenceText = file.text;
      state.referenceName = file.name;
    } else if (kind === 'untis') {
      state.untisText = file.text;
      state.untisName = file.name;
    } else if (kind === 'duties') {
      state.dutiesText = file.text;
      state.dutiesName = file.name;
    }
    state.persistenceStatus = 'ready';
    if (state.referenceText && state.untisText && state.dutiesText) {
      const adminPanel = document.getElementById('admin-panel');
      if (adminPanel) adminPanel.open = false;
    }
    showError('');
  }

  async function clearUploadedFile(kind) {
    state.persistenceStatus = 'saving';
    await deleteGuardiesFile(state.courseId, kind);
    if (kind === 'reference') {
      state.referenceText = '';
      state.referenceName = '';
    } else if (kind === 'untis') {
      state.untisText = '';
      state.untisName = '';
    } else if (kind === 'duties') {
      state.dutiesText = '';
      state.dutiesName = '';
    }
    state.persistenceStatus = 'ready';
    showError('');
  }

  async function removeUploadedFile(kind) {
    if (!state.canWrite || !['reference', 'untis', 'duties'].includes(kind)) return;
    try {
      await clearUploadedFile(kind);
      state.professor = '';
      state.absencies.clear();
      state.assignacions.clear();
      state.assignmentSources.clear();
      state.comentaris.clear();
      state.grupsFora.clear();
      state.grupProfessorsFora.clear();
      state.grupProfessorsAlliberats.clear();
      state.partialGroups.clear();
      state.outingAbsenceIds.clear();
      parseStoredData({ resetSelection: true });
    } catch (error) {
      state.persistenceStatus = 'error';
      showError(`No s'ha pogut eliminar el fitxer. ${error.message || error}`);
      render();
    }
  }

  function parseStoredData({ resetSelection }) {
    let referenceError = '';
    let untisError = '';
    state.referencia = null;
    state.professoratUntis = null;

    if (state.referenceText) {
      try {
        state.referencia = parser.parseGestibReference(state.referenceText);
      } catch (error) {
        referenceError = error.message || String(error);
      }
    }

    if (state.untisText) {
      try {
        state.professoratUntis = parser.parseUntisProfessorat(state.untisText);
        if (!state.professoratUntis.professors.size) {
          untisError = 'No s\'ha trobat professorat reconeixible al fitxer d\'Untis.';
        }
      } catch (error) {
        untisError = error.message || String(error);
      }
    }

    try {
      if (state.dutiesText) {
        const result = parser.parseUntisHorari(state.dutiesText, {
          referencia: state.referencia,
          professoratUntis: state.professoratUntis,
        });
        state.allSessions = mergeSessions(result.sessions, []);
        teacherAliasesById = new Map();
        state.allSessions.forEach((session) => {
          if (!session.placa) return;
          const aliases = teacherAliasesById.get(session.placa) || new Set([session.placa]);
          if (session.professorCurta) aliases.add(session.professorCurta);
          teacherAliasesById.set(session.placa, aliases);
        });
        state.referencia?.places?.forEach((place) => {
          if (!place.codi) return;
          const aliases = teacherAliasesById.get(place.codi) || new Set([place.codi]);
          if (place.curta) aliases.add(place.curta);
          teacherAliasesById.set(place.codi, aliases);
        });
        state.sessions = state.allSessions.filter((session) => !isExcludedTeacher(session.placa));
        state.allProfessorOptions = professorsOrdenatsAmbLabel(state.allSessions);
        state.resum = {
          ...result.resum,
          sessions: state.sessions.length,
          professors: new Set(state.sessions.map((sessio) => sessio.placa).filter(Boolean)).size,
          dies: Array.from(new Set(state.sessions.map((sessio) => sessio.dia).filter(Boolean))).sort((a, b) => Number(a) - Number(b)),
          hores: orderedHours(state.sessions.map((sessio) => sessio.hora).filter(Boolean)),
        };
        state.resum.franges = state.resum.dies.flatMap((dia) => (
          state.resum.hores
            .filter((hora) => state.sessions.some((sessio) => sessio.dia === dia && sessio.hora === hora))
            .map((hora) => ({ key: parser.franjaKey(dia, hora), dia, hora, diaLabel: parser.diaLabel(dia), total: 0 }))
        ));
        applyDefaultGuardiaCodes(result.defaultGuardiaCodes);
        if (resetSelection) {
          state.professor = '';
          state.absencies.clear();
          state.assignacions.clear();
          state.assignmentSources.clear();
          state.comentaris.clear();
          state.grupsFora.clear();
          state.grupProfessorsFora.clear();
          state.grupProfessorsAlliberats.clear();
          state.partialGroups.clear();
          state.outingAbsenceIds.clear();
        }
        renderInitialData();
      } else {
        state.sessions = [];
        state.allSessions = [];
        state.allProfessorOptions = [];
        teacherAliasesById = new Map();
        state.resum = null;
      }

      const warnings = [];
      if (referenceError) warnings.push(`El XML de GestIB no s'ha pogut llegir: ${referenceError}`);
      if (untisError) warnings.push(`El professorat d'Untis no s'ha pogut llegir: ${untisError}`);
      showError(warnings.join(' '));
    } catch (error) {
      state.sessions = [];
      state.allSessions = [];
      state.allProfessorOptions = [];
      teacherAliasesById = new Map();
      state.resum = null;
      state.professor = '';
      state.absencies.clear();
      state.assignacions.clear();
      state.assignmentSources.clear();
      state.comentaris.clear();
      state.grupsFora.clear();
      state.grupProfessorsFora.clear();
      state.grupProfessorsAlliberats.clear();
      state.partialGroups.clear();
      state.outingAbsenceIds.clear();
      showError(error.message || String(error));
    }

    render();
  }

  function applyDefaultGuardiaCodes(defaultCodes) {
    const candidates = (defaultCodes || []).filter(Boolean);
    if (!candidates.length) return;

    const activityValues = new Set((state.resum?.activitats || []).map((activitat) => activitat.valor));
    const hasValidSelection = Array.from(state.guardiaCodes).some((code) => activityValues.has(code));
    if (hasValidSelection) return;

    state.guardiaCodes = new Set(candidates);
    saveGuardCodes();
  }

  async function clearPersistentFiles() {
    if (!state.canWrite || !state.courseId) return;
    const confirmed = window.confirm('Vols eliminar els tres fitxers compartits de guàrdies?');
    if (!confirmed) return;
    try {
      state.persistenceStatus = 'saving';
      await Promise.all(
        ['reference', 'untis', 'duties', 'schedule']
          .map((kind) => deleteGuardiesFile(state.courseId, kind)),
      );
      state.referenceText = '';
      state.referenceName = '';
      state.untisText = '';
      state.untisName = '';
      state.dutiesText = '';
      state.dutiesName = '';
      state.referencia = null;
      state.professoratUntis = null;
      state.sessions = [];
      state.allSessions = [];
      state.allProfessorOptions = [];
      teacherAliasesById = new Map();
      state.resum = null;
      state.professor = '';
      state.absencies.clear();
      state.assignacions.clear();
      state.assignmentSources.clear();
      state.comentaris.clear();
      state.grupsFora.clear();
      state.grupProfessorsFora.clear();
      state.grupProfessorsAlliberats.clear();
      state.partialGroups.clear();
      state.outingAbsenceIds.clear();
      state.persistenceStatus = 'ready';
      showError('');
      render();
    } catch (error) {
      state.persistenceStatus = 'error';
      showError(`No s'han pogut eliminar els fitxers. ${error.message || error}`);
      render();
    }
  }

  function renderInitialData() {
    if (!state.resum) return;
    el.statSessions.textContent = state.resum.sessions;
    el.statProfessors.textContent = state.resum.professors;
    el.statGrups.textContent = state.resum.grups;
    el.statActivitats.textContent = state.resum.activitats.length;
    el.statReference.textContent = state.referencia ? 'Sí' : state.referenceText ? 'Error' : 'No';
    renderProfessorSelect();
  }

  function renderProfessorSelect() {
    if (!state.sessions.length) {
      state.professorOptions = [];
      el.professorSelect.innerHTML = '';
      el.professorResults.innerHTML = '';
      el.selectedProfessorLabel.textContent = 'Cap professor';
      return;
    }

    const professors = professorsOrdenatsAmbLabel();
    state.professorOptions = professors;
    if (!state.professor || !professors.some((prof) => prof.placa === state.professor)) {
      state.professor = '';
    }

    el.professorSelect.innerHTML = `
      <option value="">Selecciona professor...</option>
      ${professors.map((professor) => `
        <option value="${escapeHtml(professor.placa)}" ${professor.placa === state.professor ? 'selected' : ''}>
        ${escapeHtml(professor.label)}
        </option>
      `).join('')}
    `;

    if (!state.professor) {
      el.selectedProfessorLabel.textContent = 'Cap professor';
      el.professorSearch.value = '';
      el.professorResults.innerHTML = '';
      el.professorSearch.setAttribute('aria-expanded', 'false');
      return;
    }

    const selectedLabel = labelProfessor(state.professor);
    el.selectedProfessorLabel.textContent = selectedLabel;
    if (!el.professorSearch.value) el.professorSearch.value = selectedLabel;
    renderProfessorResults(el.professorSearch.value);
  }

  function renderProfessorResults(query = '') {
    if (!state.sessions.length) {
      el.professorResults.innerHTML = '';
      el.professorSearch.setAttribute('aria-expanded', 'false');
      return;
    }

    const normalizedQuery = normalizeSearch(query);
    const selectedLabel = labelProfessor(state.professor);
    if (!normalizedQuery || normalizedQuery === normalizeSearch(selectedLabel)) {
      el.professorResults.innerHTML = '';
      professorResultIndex = -1;
      el.professorSearch.setAttribute('aria-expanded', 'false');
      return;
    }

    const professors = professorsOrdenatsAmbLabel()
      .filter((professor) => {
        const haystack = normalizeSearch(`${professor.label} ${professor.short} ${professor.name} ${professor.placa}`);
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 12);

    if (!professors.length) {
      el.professorResults.innerHTML = '<div class="search-empty">Sense resultats</div>';
      professorResultIndex = -1;
      el.professorSearch.setAttribute('aria-expanded', 'true');
      return;
    }

    el.professorResults.innerHTML = professors.map((professor) => `
      <button
        type="button"
        class="search-result ${professor.placa === state.professor ? 'active' : ''}"
        data-professor="${escapeHtml(professor.placa)}"
        role="option"
        aria-selected="false"
      >
        <strong>${escapeHtml(professor.name || professor.short || 'Professor/a sense nom')}</strong>
        ${professor.name && professor.short ? `<span>${escapeHtml(professor.short)}</span>` : ''}
      </button>
    `).join('');

    const buttons = Array.from(el.professorResults.querySelectorAll('[data-professor]'));
    professorResultIndex = Math.min(Math.max(professorResultIndex, 0), buttons.length - 1);
    highlightProfessorResult(buttons);
    el.professorSearch.setAttribute('aria-expanded', 'true');

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        selectProfessor(button.dataset.professor);
      });
    });
  }

  function highlightProfessorResult(buttons = Array.from(el.professorResults.querySelectorAll('[data-professor]'))) {
    buttons.forEach((button, index) => {
      const selected = index === professorResultIndex;
      button.classList.toggle('suggested', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    buttons[professorResultIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function selectProfessor(placa) {
    if (!placa || placa === state.professor) {
      if (placa) {
        const label = labelProfessor(placa);
        el.professorSearch.value = label;
        el.selectedProfessorLabel.textContent = label;
        el.professorResults.innerHTML = '';
        el.professorSearch.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    state.professor = placa;
    const label = labelProfessor(placa);
    el.professorSearch.value = label;
    el.selectedProfessorLabel.textContent = label;
    el.professorResults.innerHTML = '';
    professorResultIndex = -1;
    el.professorSearch.setAttribute('aria-expanded', 'false');
    render();
  }

  function professorsOrdenatsAmbLabel(sessions = state.sessions) {
    return parser.professorsOrdenats(sessions)
      .map((professor) => ({
        ...professor,
        short: professorShort(professor.placa),
        name: professorInfo(professor.placa).name,
        hasShort: Boolean(professorInfo(professor.placa).short),
        label: labelProfessor(professor.placa),
      }))
      .sort((a, b) => {
        if (a.hasShort !== b.hasShort) return a.hasShort ? -1 : 1;
        return (a.short || a.placa).localeCompare(b.short || b.placa, 'ca', { numeric: true });
      });
  }

  function grupsOrdenatsAmbLabel() {
    const grups = new Map();
    state.referencia?.grups?.forEach((grup) => {
      if (!grup.codi) return;
      grups.set(grup.codi, {
        codi: grup.codi,
        label: grup.visible || grup.nom || grup.codi,
        curs: grup.cursVisible || grup.curs || '',
      });
    });

    state.sessions.forEach((sessio) => {
      if (!sessio.teClasse || !sessio.grup) return;
      const existing = grups.get(sessio.grup);
      const label = sessio.grupVisible || sessio.cursVisible || 'Grup sense nom';
      grups.set(sessio.grup, {
        codi: sessio.grup,
        label: existing?.label || label,
        curs: existing?.curs || sessio.cursVisible || sessio.curs || '',
      });
    });

    return Array.from(grups.values())
      .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));
  }

  function renderGroupPicker() {
    const grups = grupsOrdenatsAmbLabel();
    const validGroups = new Set(grups.map((grup) => grup.codi));
    if (state.canWrite) {
      Array.from(state.grupsFora).forEach((codi) => {
        if (!validGroups.has(codi)) {
          state.grupsFora.delete(codi);
          state.grupProfessorsFora.delete(codi);
          state.grupProfessorsAlliberats.delete(codi);
        }
      });
    }

    renderSelectedGroupsByHour(grups);
    const available = grups.filter((grup) => !state.grupsFora.has(grup.codi));
    el.groupSearch.innerHTML = `
      <option value="">Selecciona un grup per afegir-lo...</option>
      ${available.map((grup) => `
        <option value="${escapeHtml(grup.codi)}">${escapeHtml(grup.label)}</option>
      `).join('')}
    `;
    el.groupSearch.value = '';
    el.groupSearch.disabled = !state.canWrite || state.dayStatus === 'closed' || !available.length;
    el.clearGroups.disabled = !state.canWrite || state.dayStatus === 'closed' || !state.grupsFora.size;
  }

  function renderSelectedGroups(grups = grupsOrdenatsAmbLabel()) {
    const byCode = new Map(grups.map((grup) => [grup.codi, grup]));
    const selected = Array.from(state.grupsFora)
      .map((codi) => byCode.get(codi))
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));

    if (!selected.length) {
      el.selectedGroups.innerHTML = '<div class="empty-small">Cap grup seleccionat.</div>';
      return;
    }

    el.selectedGroups.innerHTML = selected.map((grup) => `
      <span class="chip group-chip">
        ${escapeHtml(grup.label)}
        <button type="button" aria-label="Treu ${escapeHtml(grup.label)}" data-remove-group="${escapeHtml(grup.codi)}">×</button>
      </span>
    `).join('');

    el.selectedGroups.querySelectorAll('[data-remove-group]').forEach((button) => {
      button.addEventListener('click', () => {
        toggleGroupOut(button.dataset.removeGroup);
      });
    });
  }

  function renderSelectedGroupsByHour(grups = grupsOrdenatsAmbLabel()) {
    const byCode = new Map(grups.map((grup) => [grup.codi, grup]));
    const selected = Array.from(state.grupsFora)
      .map((codi) => byCode.get(codi))
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));

    if (!selected.length) {
      el.selectedGroups.innerHTML = '<div class="empty-small">Cap grup seleccionat.</div>';
      return;
    }

    el.selectedGroups.innerHTML = selected.map((grup) => {
      const completeGroups = new Set(Array.from(state.grupsFora).filter((groupId) => !state.partialGroups.has(groupId)));
      const groupIsComplete = completeGroups.has(grup.codi);
      const teachingBlocks = groupTeachingBlocksForGroup(grup.codi);
      const companions = groupCompanionTeacherIds(grup.codi);
      const allCompanions = allCompanionTeacherIds();
      const defaultReleased = new Set(teachingBlocks
        .filter((block) => !allCompanions.has(block.placa) && block.grups.every((groupId) => completeGroups.has(groupId)))
        .map((block) => groupProfessorKey(block.hora, block.placa)));
      const selectedReleased = state.grupProfessorsAlliberats.get(grup.codi)
        || defaultReleased;
      const availableCompanions = professorsOrdenatsAmbLabel()
        .filter((professor) => !companions.includes(professor.placa));
      return `
        <article class="selected-group-card">
          <div class="selected-group-head">
            <strong>${escapeHtml(grup.label)}</strong>
            <button
              type="button"
              class="remove-group"
              aria-label="Treu ${escapeHtml(grup.label)}"
              title="Treu aquest grup"
              data-remove-group="${escapeHtml(grup.codi)}"
              ${!state.canWrite || state.dayStatus === 'closed' ? 'disabled' : ''}
            >
              <span aria-hidden="true">X</span> Treu
            </button>
          </div>
          <label class="group-completeness ${groupIsComplete ? '' : 'is-partial'}">
            <input
              type="checkbox"
              data-group-complete="${escapeHtml(grup.codi)}"
              ${groupIsComplete ? 'checked' : ''}
              ${!state.canWrite || state.dayStatus === 'closed' ? 'disabled' : ''}
            />
            <span>
              <strong>Surt tot el grup</strong>
            </span>
          </label>
          <div class="companion-picker">
            <label>
              <span>Afegeix professorat acompanyant</span>
              <select data-add-group-companion="${escapeHtml(grup.codi)}" ${!state.canWrite || state.dayStatus === 'closed' || !availableCompanions.length ? 'disabled' : ''}>
                <option value="">Selecciona un professor...</option>
                ${availableCompanions.map((professor) => `<option value="${escapeHtml(professor.placa)}">${escapeHtml(professor.label)}</option>`).join('')}
              </select>
            </label>
            <div class="companion-chips">
              ${companions.length ? companions.map((teacherId) => `
                <span class="companion-chip" data-group-companion="${escapeHtml(grup.codi)}" data-teacher="${escapeHtml(teacherId)}">
                  ${escapeHtml(labelProfessor(teacherId))}
                  <button type="button" aria-label="Treu ${escapeHtml(labelProfessor(teacherId))} dels acompanyants" data-remove-group-companion="${escapeHtml(grup.codi)}" data-teacher="${escapeHtml(teacherId)}" ${!state.canWrite || state.dayStatus === 'closed' ? 'disabled' : ''}>×</button>
                </span>
              `).join('') : ''}
            </div>
          </div>
          <p class="group-teacher-title">Professorat disponible en quedar lliure el grup</p>
          <div class="group-teacher-list companion-list">
            ${teachingBlocks.map((block) => {
                const key = groupProfessorKey(block.hora, block.placa);
                const remainingGroups = block.grups
                  .filter((groupId) => groupId !== grup.codi && !completeGroups.has(groupId))
                  .map((groupId) => byCode.get(groupId)?.label || groupId);
                const eligible = groupIsComplete && !remainingGroups.length && !allCompanions.has(block.placa);
                return `
                  <label class="group-teacher">
                    <input type="checkbox" data-group-released="${escapeHtml(grup.codi)}" value="${escapeHtml(key)}" ${selectedReleased.has(key) && eligible ? 'checked' : ''} ${!state.canWrite || state.dayStatus === 'closed' || !eligible ? 'disabled' : ''} />
                    <span>
                      <b>${escapeHtml(labelProfessor(block.placa))}</b>
                      <small>${escapeHtml(horaLabel(block.hora))}</small>
                      ${!groupIsComplete
                        ? '<small class="shared-group-warning">Sortida parcial</small>'
                        : remainingGroups.length
                          ? `<small class="shared-group-warning">També: ${escapeHtml(remainingGroups.join(' + '))}</small>`
                          : ''}
                      ${allCompanions.has(block.placa) ? '<small class="shared-group-warning">Acompanyant</small>' : ''}
                    </span>
                  </label>
                `;
              }).join('')}
          </div>
        </article>
      `;
    }).join('');

    el.selectedGroups.querySelectorAll('[data-remove-group]').forEach((button) => {
      button.addEventListener('click', () => {
        toggleGroupOut(button.dataset.removeGroup);
      });
    });

    el.selectedGroups.querySelectorAll('[data-group-complete]').forEach((input) => {
      input.addEventListener('change', () => {
        setGroupCompleteness(input.dataset.groupComplete, input.checked);
      });
    });

    el.selectedGroups.querySelectorAll('[data-group-released]').forEach((input) => {
      input.addEventListener('change', () => {
        setGroupReleased(input.dataset.groupReleased, input.value, input.checked);
      });
    });

    el.selectedGroups.querySelectorAll('[data-add-group-companion]').forEach((select) => {
      select.addEventListener('change', () => {
        if (select.value) addGroupCompanion(select.dataset.addGroupCompanion, select.value);
      });
    });

    el.selectedGroups.querySelectorAll('[data-remove-group-companion]').forEach((button) => {
      button.addEventListener('click', () => {
        removeGroupCompanion(button.dataset.removeGroupCompanion, button.dataset.teacher);
      });
    });
  }

  function toggleGroupOut(codi) {
    if (!state.canWrite || state.dayStatus === 'closed') return;
    if (!codi) return;
    const exclusions = releasedSelectionExclusions();
    if (state.grupsFora.has(codi)) {
      state.grupsFora.delete(codi);
      state.grupProfessorsFora.delete(codi);
      state.grupProfessorsAlliberats.delete(codi);
      state.partialGroups.delete(codi);
      syncOutingAbsences();
    } else {
      state.grupsFora.add(codi);
      ensureGroupProfessorSelection(codi);
      state.partialGroups.delete(codi);
    }
    refreshAutomaticReleasedSelections(exclusions);
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
    scheduleDaySave();
  }

  function addGroupOut(codi) {
    if (!state.canWrite || state.dayStatus === 'closed') return;
    if (!codi) return;
    const exclusions = releasedSelectionExclusions();
    state.grupsFora.add(codi);
    ensureGroupProfessorSelection(codi);
    state.partialGroups.delete(codi);
    refreshAutomaticReleasedSelections(exclusions);
    el.groupSearch.value = '';
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
  }

  function setGroupCompleteness(codi, complete) {
    if (!state.canWrite || state.dayStatus === 'closed' || !state.grupsFora.has(codi)) return;
    const exclusions = releasedSelectionExclusions();
    if (complete) state.partialGroups.delete(codi);
    else state.partialGroups.add(codi);
    refreshAutomaticReleasedSelections(exclusions);
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
    scheduleDaySave();
  }

  function groupTeachingBlocksForGroup(codi) {
    const dia = diaXmlSeleccionat();
    if (!dia) return [];
    return groupTeachingBlocks(
      state.sessions.filter((sessio) => sessio.dia === dia && sessio.teClasse),
    )
      .filter((item) => item.grups.includes(codi))
      .sort(sortCoverageItems);
  }

  function groupProfessorKey(hora, placa) {
    return `${hora}|${placa}`;
  }

  function ensureGroupProfessorSelection(codi) {
    if (state.grupProfessorsFora.has(codi)) return;
    state.grupProfessorsFora.set(codi, new Set());
  }

  function groupCompanionTeacherIds(codi) {
    return Array.from(new Set(
      Array.from(state.grupProfessorsFora.get(codi) || [])
        .map((key) => key.split('|').slice(1).join('|'))
        .filter(Boolean),
    )).sort((a, b) => labelProfessor(a).localeCompare(labelProfessor(b), 'ca', { numeric: true }));
  }

  function allCompanionTeacherIds() {
    const teachers = new Set();
    state.grupProfessorsFora.forEach((keys) => {
      keys.forEach((key) => {
        const teacherId = key.split('|').slice(1).join('|');
        if (teacherId) teachers.add(teacherId);
      });
    });
    return teachers;
  }

  function addGroupCompanion(codi, placa) {
    if (!state.canWrite || state.dayStatus === 'closed' || !codi || !placa) return;
    const exclusions = releasedSelectionExclusions();
    ensureGroupProfessorSelection(codi);
    const professors = state.grupProfessorsFora.get(codi);
    const blocks = groupTeachingBlocksForGroup(codi).filter((item) => item.placa === placa);
    if (blocks.length) blocks.forEach((item) => professors.add(groupProfessorKey(item.hora, placa)));
    else professors.add(groupProfessorKey('*', placa));
    refreshAutomaticReleasedSelections(exclusions);
    syncOutingAbsences();
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
  }

  function removeGroupCompanion(codi, placa) {
    if (!state.canWrite || state.dayStatus === 'closed' || !codi || !placa) return;
    const exclusions = releasedSelectionExclusions();
    const professors = state.grupProfessorsFora.get(codi);
    if (!professors) return;
    Array.from(professors)
      .filter((key) => key.endsWith(`|${placa}`))
      .forEach((key) => professors.delete(key));
    refreshAutomaticReleasedSelections(exclusions);
    syncOutingAbsences();
    renderGroupPicker();
    renderCoverage();
    renderReleasedList();
  }

  function defaultReleasedGroupKeys(codi) {
    const completeGroups = new Set(Array.from(state.grupsFora).filter((groupId) => !state.partialGroups.has(groupId)));
    const companions = allCompanionTeacherIds();
    return new Set(groupTeachingBlocksForGroup(codi)
      .filter((block) => !companions.has(block.placa) && block.grups.every((groupId) => completeGroups.has(groupId)))
      .map((block) => groupProfessorKey(block.hora, block.placa)));
  }

  function setGroupReleased(codi, key, enabled) {
    if (!state.canWrite || state.dayStatus === 'closed' || !codi || !key) return;
    if (!state.grupProfessorsAlliberats.has(codi)) {
      state.grupProfessorsAlliberats.set(codi, defaultReleasedGroupKeys(codi));
    }
    const selected = state.grupProfessorsAlliberats.get(codi);
    if (enabled) selected.add(key);
    else selected.delete(key);
    renderCoverage();
    renderReleasedList();
    scheduleDaySave();
  }

  function releasedSelectionExclusions() {
    const exclusions = new Map();
    state.grupsFora.forEach((groupId) => {
      const selected = state.grupProfessorsAlliberats.get(groupId);
      if (!selected) return;
      exclusions.set(groupId, new Set(
        Array.from(defaultReleasedGroupKeys(groupId)).filter((key) => !selected.has(key)),
      ));
    });
    return exclusions;
  }

  function refreshAutomaticReleasedSelections(exclusions = new Map()) {
    state.grupsFora.forEach((groupId) => {
      const excluded = exclusions.get(groupId) || new Set();
      state.grupProfessorsAlliberats.set(groupId, new Set(
        Array.from(defaultReleasedGroupKeys(groupId)).filter((key) => !excluded.has(key)),
      ));
    });
  }

  function renderConvivenciaAdmin() {
    if (!el.convivenciaAdminList) return;
    const hores = (state.resum?.hores || []).slice()
      .sort((a, b) => a.localeCompare(b, 'ca', { numeric: true }));
    if (!state.sessions.length || !hores.length) {
      el.convivenciaAdminList.innerHTML = '<div class="empty-small">Completa els tres fitxers per configurar la setmana.</div>';
      return;
    }

    const dies = ['1', '2', '3', '4', '5'];

    el.convivenciaAdminList.innerHTML = `
      <div class="convivencia-week">
        ${dies.map((dia) => `
          <section class="convivencia-day">
            <h3>${escapeHtml(parser.diaLabel(dia))}</h3>
            <div class="convivencia-day-slots">
              ${hores.map((hora, index) => {
                const key = convivenciaKey(dia, hora);
                const selected = convivenciaProfessors(dia, hora)[0] || '';
                const candidates = guardiaProfessorsForSlot(dia, hora);
                const selectedIsCandidate = candidates.some((candidate) => candidate.placa === selected);
                const emptyLabel = candidates.length ? 'Sense cobertura' : 'Cap professor de guàrdia';
                const options = candidates.map((candidate) => `
                  <option value="${escapeHtml(candidate.placa)}">
                    ${escapeHtml(`${candidate.convivencia ? 'GC · ' : ''}${candidate.label}`)}
                  </option>
                `).join('');
                const previousOption = selected && !selectedIsCandidate
                  ? `<option value="${escapeHtml(selected)}">${escapeHtml(`Assignació anterior · ${labelProfessor(selected)}`)}</option>`
                  : '';
                return `
                  <label class="convivencia-slot ${selected ? 'covered' : ''} ${candidates.length ? '' : 'without-guards'}">
                    <span class="convivencia-slot-time">
                      <strong>${index + 1}a</strong>
                      <small>${escapeHtml(hora)}</small>
                    </span>
                    <select data-convivencia-slot="${escapeHtml(key)}" aria-label="Convivència ${escapeHtml(parser.diaLabel(dia))} ${escapeHtml(hora)}">
                      <option value="">${emptyLabel}</option>
                      ${previousOption}
                      ${options}
                    </select>
                  </label>
                `;
              }).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    `;

    el.convivenciaAdminList.querySelectorAll('[data-convivencia-slot]').forEach((select) => {
      const selected = convivenciaProfessors(...select.dataset.convivenciaSlot.split('|'))[0] || '';
      select.value = selected;
      select.disabled = !state.canWrite || state.persistenceStatus === 'saving';
      select.addEventListener('change', async () => {
        const key = select.dataset.convivenciaSlot;
        if (select.value) state.convivencia.set(key, new Set([select.value]));
        else state.convivencia.set(key, new Set());
        renderConvivenciaAdmin();
        renderCoverage();
        await saveConvivencia();
      });
    });
  }

  function render() {
    const ready = state.contextReady
      && state.persistenceStatus !== 'loading'
      && state.dayPersistenceStatus !== 'loading'
      && state.dayLoaded;
    const hasSchedule = Boolean(state.sessions.length);
    const hasVisibleDay = (state.isAdmin && !state.teacherView)
      || ['published', 'closed'].includes(state.dayStatus);
    const teDades = ready && hasSchedule && hasVisibleDay;
    el.workspace.classList.toggle('hidden', !teDades);
    el.empty.classList.toggle('hidden', teDades);
    if (!ready) return;

    renderConvivenciaAdmin();
    if (!teDades) return;

    renderInitialData();
    renderGroupPicker();
    renderPublicOutingGroups();
    renderSchedule();
    renderCoverage();
    renderReleasedList();
  }

  function renderPublicOutingGroups() {
    if (!el.publicOutingList) return;
    const labels = new Map(grupsOrdenatsAmbLabel().map((group) => [String(group.codi), group.label]));
    const groups = Array.from(state.grupsFora)
      .map((groupId) => ({
        id: String(groupId),
        label: labels.get(String(groupId)) || String(groupId),
        partial: state.partialGroups.has(groupId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ca', { numeric: true }));
    el.publicOutingList.innerHTML = groups.length
      ? groups.map((group) => `
          <article class="teacher-outing-group" data-public-outing-group="${escapeHtml(group.id)}">
            <strong>${escapeHtml(group.label)}</strong>
            <span>${group.partial ? 'Sortida parcial' : 'Fora del centre'}</span>
          </article>
        `).join('')
      : '<div class="empty-small">—</div>';
  }


  function renderSchedule() {
    const dia = diaXmlSeleccionat();
    if (!state.professor) {
      el.scheduleTitle.textContent = 'Sessions del professor';
      el.addAllHours.disabled = true;
      el.clearMissing.disabled = true;
      el.scheduleGrid.innerHTML = '<div class="empty-small">Cerca i selecciona el professor que falta.</div>';
      return;
    }
    const professorLabel = labelProfessor(state.professor);
    const items = currentProfessorDayItems();
    const selectableItems = items.filter(isAbsenceSelectable);

    trimCurrentProfessorAbsences(items);
    el.scheduleTitle.textContent = `${professorLabel} · ${parser.diaLabel(dia)}`;
    el.addAllHours.disabled = state.dayStatus === 'closed' || !selectableItems.length;
    el.clearMissing.disabled = state.dayStatus === 'closed' || !selectableItems.some((item) => state.absencies.has(item.id));

    if (!items.length) {
      renderEmptySchedule(dia);
      return;
    }

    el.scheduleGrid.innerHTML = items.map((item) => {
      const selectable = isAbsenceSelectable(item);
      const checked = state.absencies.has(item.id) ? 'checked' : '';
      const disabled = selectable && state.dayStatus !== 'closed' ? '' : 'disabled';
      const tipus = tipusItem(item);
      return `
        <label class="schedule-item ${selectable ? '' : 'schedule-item-muted'}">
          <input type="checkbox" data-absence="${escapeHtml(item.id)}" ${checked} ${disabled} />
          <span class="schedule-time">${escapeHtml(item.hora)}</span>
          <span class="schedule-main">
            <strong>${escapeHtml(formatMateria(item))}</strong>
            <small>${escapeHtml(formatBlocCurt(item))}</small>
          </span>
          <span class="schedule-type">${escapeHtml(tipus)}</span>
        </label>
      `;
    }).join('');

    el.scheduleGrid.querySelectorAll('[data-absence]').forEach((input) => {
      input.addEventListener('change', () => {
        const item = items.find((candidate) => candidate.id === input.dataset.absence);
        if (input.checked && item) state.absencies.set(item.id, item);
        else {
          state.absencies.delete(input.dataset.absence);
          state.assignacions.delete(input.dataset.absence);
          state.assignmentSources.delete(input.dataset.absence);
          state.comentaris.delete(input.dataset.absence);
        }
        renderCoverage();
      });
    });
  }

  function renderEmptySchedule(dia) {
    const weekItems = allProfessorWeekItems();
    if (!weekItems.length) {
      el.scheduleGrid.innerHTML = '<div class="empty-small">Aquest professor no té sessions al GPU001 carregat.</div>';
      return;
    }

    const byDay = new Map();
    weekItems.forEach((item) => {
      if (!byDay.has(item.dia)) byDay.set(item.dia, []);
      byDay.get(item.dia).push(item);
    });

    const dayButtons = Array.from(byDay.entries())
      .sort(([diaA], [diaB]) => Number(diaA) - Number(diaB))
      .map(([itemDia, dayItems]) => {
        const hores = Array.from(new Set(dayItems.map((item) => item.hora).filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, 'ca', { numeric: true }));
        return `
          <button type="button" class="ghost" data-jump-day="${escapeHtml(itemDia)}">
            ${escapeHtml(parser.diaLabel(itemDia))} · ${escapeHtml(hores.join(', ') || 'sense hora')}
          </button>
        `;
      })
      .join('');

    el.scheduleGrid.innerHTML = `
      <div class="empty-small schedule-empty">
        <p>Aquest professor no té sessions a ${escapeHtml(parser.diaLabel(dia))}.</p>
        <div class="day-jumps">${dayButtons}</div>
      </div>
    `;

    el.scheduleGrid.querySelectorAll('[data-jump-day]').forEach((button) => {
      button.addEventListener('click', () => {
        setDateToXmlDay(button.dataset.jumpDay);
        state.absencies.clear();
        state.assignacions.clear();
        state.assignmentSources.clear();
        state.comentaris.clear();
        state.grupsFora.clear();
        state.grupProfessorsFora.clear();
        state.grupProfessorsAlliberats.clear();
        state.partialGroups.clear();
        state.outingAbsenceIds.clear();
        render();
      });
    });
  }

  function renderCoverage() {
    const selected = selectedAbsenceItems();
    selected.forEach((item) => {
      const classroomPartner = classroomPartnerForAbsence({
        sessions: state.sessions,
        absence: item,
        absences: state.absencies,
      });
      if (classroomPartner) {
        state.assignacions.set(item.id, classroomPartner);
        state.assignmentSources.set(item.id, 'co-teacher');
        state.cancelledAssignments.delete(item.id);
        return;
      }
      if (state.assignmentSources.get(item.id) === 'co-teacher') {
        state.assignacions.delete(item.id);
        state.assignmentSources.delete(item.id);
      }
      const assignat = state.assignacions.get(item.id);
      if (!assignat) return;
      const candidate = guardiesPerFranja(item.dia, item.hora, item.placa, item.id)
        .find((option) => option.placa === assignat && !option.unavailable);
      if (!candidate) {
        state.assignacions.delete(item.id);
        state.assignmentSources.delete(item.id);
      } else {
        state.assignmentSources.set(
          item.id,
          candidate.alliberaments?.length ? 'released' : candidate.outsideDuty ? 'other' : 'guard',
        );
      }
    });
    const coverageItems = mergeSharedClassroomAbsences({ sessions: state.sessions, absences: selected });
    consolidateMergedCoverageState(coverageItems);
    el.printDateLabel.textContent = formatData(state.date);

    const warning = hasGuardiaCandidates()
      ? ''
      : `<div class="empty-small no-print">Marca l'activitat de guàrdia per trobar professorat disponible.</div>`;
    const selectedByHour = new Map(groupBySession(coverageItems).map((group) => [group.hora, group.items]));

    const dayHours = hoursForSelectedDay();
    const teachingHours = dayHours.filter((hora) => hora !== 'PATI');
    const seventhHour = teachingHours.length >= 7 ? teachingHours[6] : '';
    el.coverageList.innerHTML = warning + dayHours.map((hora) => {
      const items = selectedByHour.get(hora) || [];
      const visibleItems = hora === 'PATI' ? [] : items;
      return `
      <section class="coverage-session ${hora === 'PATI' ? 'pati-session' : ''} ${hora === seventhHour ? 'seventh-session' : ''}">
        <div class="coverage-session-head">
          <h3>${escapeHtml(horaLabel(hora))}</h3>
          <span>${items.length ? `${items.length} ${items.length === 1 ? 'absència' : 'absències'}` : 'Sense absències'}</span>
        </div>
        ${hora === 'PATI' ? renderPatiForDate() : ''}
        ${visibleItems.length ? `
          <div class="coverage-session-list">
            <div class="coverage-table">
              <div class="coverage-row coverage-row-head">
                <span>Professor/a</span>
                <span>Grup, matèria i aula</span>
                <span>Professor/a preassignat/ada</span>
                <span>Observacions</span>
              </div>
              ${visibleItems.map(renderCoverageRow).join('')}
            </div>
          </div>
        ` : ''}
      </section>
    `;
    }).join('');

    el.coverageList.querySelectorAll('[data-assignacio]').forEach((select) => {
      select.addEventListener('change', () => {
        if (state.dayStatus === 'closed') return;
        state.cancelledAssignments.delete(select.dataset.assignacio);
        if (select.value) {
          const absence = state.absencies.get(select.dataset.assignacio);
          const candidate = absence
            ? guardiesPerFranja(absence.dia, absence.hora, absence.placa, absence.id)
              .find((item) => item.placa === select.value)
            : null;
          state.assignacions.set(select.dataset.assignacio, select.value);
          state.assignmentSources.set(
            select.dataset.assignacio,
            candidate?.alliberaments?.length ? 'released' : candidate?.outsideDuty ? 'other' : 'guard',
          );
        } else {
          state.assignacions.delete(select.dataset.assignacio);
          state.assignmentSources.delete(select.dataset.assignacio);
        }
        renderCoverage();
      });
    });

    el.coverageList.querySelectorAll('[data-clear-assignacio]').forEach((button) => {
      button.addEventListener('click', () => {
        state.assignacions.delete(button.dataset.clearAssignacio);
        state.assignmentSources.delete(button.dataset.clearAssignacio);
        renderCoverage();
      });
    });

    el.coverageList.querySelectorAll('[data-comment]').forEach((input) => {
      input.addEventListener('input', () => {
        if (state.dayStatus === 'closed') return;
        updateComment(input.dataset.comment, input.value);
        const preset = Array.from(el.coverageList.querySelectorAll('[data-comment-preset]'))
          .find((node) => node.dataset.commentPreset === input.dataset.comment);
        if (preset) preset.value = '';
      });
    });

    el.coverageList.querySelectorAll('[data-comment-preset]').forEach((select) => {
      select.addEventListener('change', () => {
        if (state.dayStatus === 'closed' || !select.value) return;
        const input = Array.from(el.coverageList.querySelectorAll('[data-comment]'))
          .find((node) => node.dataset.comment === select.dataset.commentPreset);
        const phrase = select.value.trim();
        const current = input?.value.trim() || '';
        const alreadyIncluded = current.split(/\s+·\s+/)
          .some((part) => normalizeSearch(part) === normalizeSearch(phrase));
        const next = alreadyIncluded ? current : [current, phrase].filter(Boolean).join(' · ');
        if (input) input.value = next;
        select.value = '';
        updateComment(select.dataset.commentPreset, next);
      });
    });

    el.coverageList.querySelectorAll('[data-remove-absence]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.dayStatus === 'closed') return;
        const absenceIds = (button.dataset.removeAbsences || button.dataset.removeAbsence).split(',').filter(Boolean);
        absenceIds.forEach((absenceId) => {
          state.absencies.delete(absenceId);
          state.assignacions.delete(absenceId);
          state.assignmentSources.delete(absenceId);
          state.comentaris.delete(absenceId);
          state.cancelledAssignments.delete(absenceId);
        });
        renderSchedule();
        renderCoverage();
      });
    });

    el.coverageList.querySelectorAll('[data-pati-zone-override]').forEach((select) => {
      select.addEventListener('change', () => updatePatiZoneOverride(select));
    });
    el.coverageList.querySelectorAll('[data-cancel-assignment]').forEach((input) => {
      input.addEventListener('change', () => {
        if (state.dayStatus === 'closed') return;
        if (input.checked) state.cancelledAssignments.add(input.dataset.cancelAssignment);
        else state.cancelledAssignments.delete(input.dataset.cancelAssignment);
        renderCoverage();
      });
    });
    scheduleDaySave();
  }

  function updateComment(id, rawValue) {
    const value = String(rawValue || '').trim();
    if (value) state.comentaris.set(id, value);
    else state.comentaris.delete(id);
    const printComment = Array.from(el.coverageList.querySelectorAll('[data-comment-print]'))
      .find((node) => node.dataset.commentPrint === id);
    if (printComment) {
      const prefix = id === PATI_COMMENT_KEY ? 'Observacions del pati' : 'Comentari';
      printComment.textContent = value ? `${prefix}: ${value}` : '';
    }
    scheduleDaySave();
  }

  function autoAssignCoverage() {
    const reportResult = (ok, message) => {
      window.dispatchEvent(new CustomEvent('guardies:auto-assign-result', { detail: { ok, message } }));
    };
    if (!state.canWrite || state.dayStatus === 'closed') {
      reportResult(false, 'La jornada no es pot modificar.');
      return;
    }

    const pending = mergeSharedClassroomAbsences({ sessions: state.sessions, absences: selectedAbsenceItems() }).filter((item) => (
      !item.sessions?.some(isPatiGuardiaSession) && !state.assignacions.has(item.id)
    ));
    if (!pending.length) {
      reportResult(false, 'No hi ha guàrdies pendents.');
      return;
    }

    const projectedCounts = new Map();
    state.assignacions.forEach((teacherId, absenceId) => {
      const source = state.assignmentSources.get(absenceId);
      const absence = state.absencies.get(absenceId);
      const key = projectedGuardCountKey(teacherId, source, absence?.dia, absence?.hora);
      if (!key) return;
      projectedCounts.set(key, (projectedCounts.get(key) || 0) + 1);
    });

    let assigned = 0;
    pending.forEach((item) => {
      const candidates = guardiesPerFranja(item.dia, item.hora, item.placa, item.id)
        .map((candidate) => ({
          ...candidate,
          source: candidate.alliberaments?.length ? 'released' : candidate.guardies?.length ? 'guard' : '',
        }))
        .filter((candidate) => candidate.source && !candidate.unavailable && !candidate.convivencia && !candidate.outsideDuty)
        .sort((a, b) => {
          const sourceRank = (a.source === 'released' ? 0 : 1) - (b.source === 'released' ? 0 : 1);
          if (sourceRank) return sourceRank;
          const keyA = projectedGuardCountKey(a.placa, a.source, item.dia, item.hora);
          const keyB = projectedGuardCountKey(b.placa, b.source, item.dia, item.hora);
          const countRank = (guardCount(a.placa, a.source, item.dia, item.hora) + (projectedCounts.get(keyA) || 0))
            - (guardCount(b.placa, b.source, item.dia, item.hora) + (projectedCounts.get(keyB) || 0));
          if (countRank) return countRank;
          return labelProfessor(a.placa).localeCompare(labelProfessor(b.placa), 'ca', { numeric: true });
        });
      const selected = candidates[0];
      if (!selected) return;
      state.assignacions.set(item.id, selected.placa);
      state.assignmentSources.set(item.id, selected.source);
      state.cancelledAssignments.delete(item.id);
      const projectedKey = projectedGuardCountKey(selected.placa, selected.source, item.dia, item.hora);
      projectedCounts.set(projectedKey, (projectedCounts.get(projectedKey) || 0) + 1);
      assigned += 1;
    });

    renderCoverage();
    const uncovered = pending.length - assigned;
    const message = `${assigned} ${assigned === 1 ? 'assignada' : 'assignades'}${uncovered ? ` · ${uncovered} sense cobrir` : ''}`;
    reportResult(assigned > 0, message);
  }

  function renderConvivenciaForHour(dia, hora) {
    const professors = convivenciaProfessors(dia, hora);
    if (!professors.length) return '';
    const hasAbsence = professors.some((placa) => isProfessorAbsentAtHour(dia, hora, placa));
    return `
      <div class="convivencia-strip ${hasAbsence ? 'has-absence' : ''}">
        <span>Convivència</span>
        <div>
          ${professors.map((placa) => {
            const absent = isProfessorAbsentAtHour(dia, hora, placa);
            return `
              <strong class="${absent ? 'absent' : ''}">
                ${escapeHtml(labelProfessor(placa))}
                ${absent ? '<em>Absent</em>' : ''}
              </strong>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderPatiForDate() {
    if (!state.patiConfig) {
      return '<div class="pati-info-strip empty"><span>Zones de pati</span><p>Encara no hi ha una rotació configurada.</p></div>';
    }
    const reason = nonTeachingReason(state.date, state.patiConfig);
    if (reason) {
      return `
        <div class="pati-info-strip holiday">
          <span>Pati no lectiu</span>
          <p>${escapeHtml(reason.label)}</p>
        </div>
      `;
    }
    const assignments = patioAssignmentsForDate(state.date, state.patiConfig)
      .filter((assignment) => !isExcludedTeacher(assignment.teacherId));
    if (!assignments.length) {
      return '<div class="pati-info-strip empty"><span>Zones de pati</span><p>Sense professorat de GP configurat per a aquest dia.</p></div>';
    }
    const observation = state.comentaris.get(PATI_COMMENT_KEY) || '';
    const observationControl = state.canWrite ? `
      <label class="pati-observation no-print">
        <span>Observacions del pati</span>
        <textarea
          data-comment="${PATI_COMMENT_KEY}"
          rows="2"
          placeholder="Canvis, incidències o indicacions per al pati…"
          ${state.dayStatus === 'closed' ? 'disabled' : ''}
        >${escapeHtml(observation)}</textarea>
      </label>
    ` : observation ? `<p class="pati-observation-readonly">${escapeHtml(observation)}</p>` : '';
    return `
      <div class="pati-info-strip">
        <span>Zones de pati</span>
        <div class="pati-content">
          <div class="pati-zone-grid">
            ${assignments.map((assignment) => {
            const absent = isProfessorAbsentAtHour(diaXmlSeleccionat(), 'PATI', assignment.teacherId);
            const zoneControl = state.canWrite ? `
              <select
                class="pati-zone-select no-print"
                data-pati-zone-override="${escapeHtml(assignment.teacherId)}"
                data-pati-base-zone="${escapeHtml(assignment.baseZoneId)}"
                aria-label="Zona de ${escapeHtml(labelProfessor(assignment.teacherId))} per al ${escapeHtml(state.date)}"
              >
                <option value="">${escapeHtml(assignment.baseZoneName)} · rotació</option>
                ${state.patiConfig.zones.map((zone) => `
                  <option value="${escapeHtml(zone.id)}" ${assignment.overridden && zone.id === assignment.zoneId ? 'selected' : ''}>
                    ${escapeHtml(zone.name)}
                  </option>
                `).join('')}
              </select>
              <strong class="pati-zone-name print-only">${escapeHtml(assignment.zoneName)}</strong>
            ` : `<strong class="pati-zone-name">${escapeHtml(assignment.zoneName)}</strong>`;
            return `
              <article
                class="pati-zone-card ${absent ? 'absent' : ''} ${assignment.overridden ? 'overridden' : ''}"
                aria-label="${escapeHtml(`${assignment.zoneName}: ${labelProfessor(assignment.teacherId)}${absent ? ', absent' : ''}`)}"
              >
                ${zoneControl}
                <span class="pati-teacher-name no-print">${escapeHtml(labelProfessor(assignment.teacherId))}</span>
                <span class="pati-teacher-name print-only">${escapeHtml(labelProfessor(assignment.teacherId, true))}</span>
                ${absent
                  ? '<small class="pati-absence-badge">Absent</small>'
                  : assignment.overridden
                    ? '<small class="pati-override-badge">Canvi d\'avui</small>'
                    : '<small class="pati-card-spacer" aria-hidden="true">&nbsp;</small>'}
              </article>
            `;
            }).join('')}
          </div>
          ${observationControl}
          <p class="pati-observation-print print-only" data-comment-print="${PATI_COMMENT_KEY}">${observation ? `Observacions del pati: ${escapeHtml(observation)}` : ''}</p>
        </div>
      </div>
    `;
  }

  async function updatePatiZoneOverride(select) {
    if (!state.canWrite || !state.patiConfig) return;
    const teacherId = select.dataset.patiZoneOverride;
    const day = diaXmlSeleccionat();
    const previous = state.patiConfig;
    const next = JSON.parse(JSON.stringify(previous));
    const teacher = next.weekdayTeachers?.[day]?.find((item) => item.teacherId === teacherId);
    if (!teacher) return;
    teacher.zoneOverrides ||= {};
    const zoneId = select.value;
    if (zoneId && zoneId !== select.dataset.patiBaseZone) teacher.zoneOverrides[state.date] = zoneId;
    else delete teacher.zoneOverrides[state.date];
    state.patiConfig = next;
    renderCoverage();
    try {
      state.persistenceStatus = 'saving';
      state.patiConfig = await saveGuardiesPati(state.courseId, next);
      if (['published', 'closed'].includes(state.dayStatus)) await syncPublicGuardiesDay();
      state.persistenceStatus = 'ready';
      showError('');
      window.dispatchEvent(new CustomEvent('guardies:pati-updated'));
    } catch (error) {
      state.patiConfig = previous;
      state.persistenceStatus = 'error';
      showError(`No s'ha pogut canviar la zona del pati. ${error.message || error}`);
      renderCoverage();
    }
  }

  function mergeSessions(scheduleSessions, guardSessions) {
    const sessions = new Map();
    [...scheduleSessions, ...guardSessions].forEach((session) => {
      const semanticKey = [
        session.placa,
        session.dia,
        session.hora,
        session.teClasse ? 'classe' : 'activitat',
        session.activitat,
        session.materia,
        session.grup,
        session.aula,
      ].join('|');
      if (!sessions.has(semanticKey)) {
        sessions.set(semanticKey, session);
      } else if (session.origenGuardia === 'GPU001') {
        sessions.set(semanticKey, {
          ...sessions.get(semanticKey),
          ...session,
        });
      }
    });
    return Array.from(sessions.values()).map((session) => (
      isPatiGuardiaSession(session)
        ? { ...session, hora: 'PATI', franja: parser.franjaKey(session.dia, 'PATI') }
        : session
    )).sort((a, b) => {
      const dayDifference = Number(a.dia) - Number(b.dia);
      if (dayDifference) return dayDifference;
      const hourDifference = sortHours(a.hora, b.hora);
      if (hourDifference) return hourDifference;
      return labelProfessor(a.placa).localeCompare(labelProfessor(b.placa), 'ca', { numeric: true });
    });
  }

  function renderAbsentNormalGuardiesForHour(dia, hora) {
    const professors = parser.ocupacioFranja(state.sessions, dia, hora, state.guardiaCodes)
      .filter((professor) => professor.guardies.length && isProfessorAbsentAtHour(dia, hora, professor.placa))
      .map((professor) => professor.placa);
    const unique = Array.from(new Set(professors));
    if (!unique.length) return '';
    return `
      <div class="guard-absence-strip">
        <span>Guàrdia normal absent</span>
        <div>
          ${unique.map((placa) => `<strong>${escapeHtml(labelProfessor(placa))}</strong>`).join('')}
        </div>
      </div>
    `;
  }

  function sessionsProfessorDia(placa, dia) {
    return state.sessions.filter((sessio) => sessio.placa === placa && sessio.dia === dia && isMeaningfulSession(sessio));
  }

  function allProfessorWeekItems() {
    return parser.agruparSessionsCobertura(state.sessions.filter((sessio) => sessio.placa === state.professor && isMeaningfulSession(sessio)))
      .sort((a, b) => {
        const dia = Number(a.dia) - Number(b.dia);
        if (dia) return dia;
        return (a.hora || '').localeCompare(b.hora || '', 'ca', { numeric: true });
      });
  }

  function currentProfessorDayItems() {
    const dia = diaXmlSeleccionat();
    return dedupeScheduleItems(parser.agruparSessionsCobertura(sessionsProfessorDia(state.professor, dia)))
      .sort((a, b) => (a.hora || '').localeCompare(b.hora || '', 'ca', { numeric: true }));
  }

  function dedupeScheduleItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = [
        item.hora,
        isAbsenceSelectable(item) ? 'classe' : tipusItem(item),
        formatMateria(item),
        formatBlocCurt(item),
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function selectedAbsenceItems() {
    const dia = diaXmlSeleccionat();
    return Array.from(state.absencies.values())
      .filter((item) => item.dia === dia)
      .sort(sortCoverageItems);
  }

  function consolidateMergedCoverageState(items) {
    items.filter((item) => item.absenceIds?.length > 1).forEach((item) => {
      const primaryId = item.id;
      const assignmentId = item.absenceIds.find((absenceId) => state.assignacions.has(absenceId));
      const commentId = item.absenceIds.find((absenceId) => state.comentaris.has(absenceId));
      if (!state.assignacions.has(primaryId) && assignmentId) {
        state.assignacions.set(primaryId, state.assignacions.get(assignmentId));
        state.assignmentSources.set(primaryId, state.assignmentSources.get(assignmentId) || 'guard');
      }
      if (!state.comentaris.has(primaryId) && commentId) {
        state.comentaris.set(primaryId, state.comentaris.get(commentId));
      }
      item.absenceIds.filter((absenceId) => absenceId !== primaryId).forEach((absenceId) => {
        state.assignacions.delete(absenceId);
        state.assignmentSources.delete(absenceId);
        state.comentaris.delete(absenceId);
        state.cancelledAssignments.delete(absenceId);
      });
    });
  }

  function convivenciaKey(dia, hora) {
    return `${dia || ''}|${hora || ''}`;
  }

  function guardiaSessionText(sessio) {
    return [
      sessio?.activitat,
      sessio?.activitatCurta,
      sessio?.activitatNom,
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function isConvivenciaGuardiaSession(sessio) {
    const text = guardiaSessionText(sessio);
    return (
      /(^|\s)(gc|gconv)(\s|$)/.test(text) ||
      text.includes('convivencia')
    );
  }

  function isPatiGuardiaSession(sessio) {
    const text = guardiaSessionText(sessio);
    return sessio?.activitat === 'GP' || text.includes('guardia pati');
  }

  function guardiaProfessorsForSlot(dia, hora) {
    const professors = new Map();
    const hasGpu001Guardies = state.sessions.some((sessio) => sessio.origenGuardia === 'GPU001');
    state.sessions
      .filter((sessio) => (
        sessio.dia === dia &&
        sessio.hora === hora &&
        sessio.placa &&
        (!hasGpu001Guardies || sessio.origenGuardia === 'GPU001') &&
        isGuardiaSession(sessio) &&
        !isPatiGuardiaSession(sessio)
      ))
      .forEach((sessio) => {
        const current = professors.get(sessio.placa) || {
          placa: sessio.placa,
          label: labelProfessor(sessio.placa),
          convivencia: false,
        };
        current.convivencia ||= isConvivenciaGuardiaSession(sessio);
        professors.set(sessio.placa, current);
      });
    return Array.from(professors.values())
      .sort((a, b) => {
        if (a.convivencia !== b.convivencia) return a.convivencia ? -1 : 1;
        return a.label.localeCompare(b.label, 'ca', { numeric: true });
      });
  }

  function detectedConvivenciaProfessors(dia, hora) {
    return guardiaProfessorsForSlot(dia, hora)
      .filter((professor) => professor.convivencia)
      .map((professor) => professor.placa);
  }

  function convivenciaProfessors(dia, hora) {
    const key = convivenciaKey(dia, hora);
    const professors = state.convivencia.get(key);
    const effective = state.convivencia.has(key)
      ? Array.from(professors || [])
      : detectedConvivenciaProfessors(dia, hora);
    return effective
      .filter((teacherId) => teacherId && !isExcludedTeacher(teacherId))
      .sort((a, b) => labelProfessor(a).localeCompare(labelProfessor(b), 'ca', { numeric: true }));
  }

  function isConvivenciaProfessor(dia, hora, placa) {
    return convivenciaProfessors(dia, hora).includes(placa);
  }

  function isMeaningfulSession(sessio) {
    return Boolean(sessio?.teClasse || sessio?.teActivitat);
  }

  function guardiesPerFranja(dia, hora, professorAbsent, currentAbsenceId = '') {
    const ocupacio = parser.ocupacioFranja(state.sessions, dia, hora, state.guardiaCodes);
    const ocupacioByPlaca = new Map(ocupacio.map((professor) => [professor.placa, professor]));
    const candidates = new Map();

    ocupacio
      .filter((professor) => (
        professor.placa !== professorAbsent &&
        professor.guardies.length
      ))
      .forEach((professor) => {
        candidates.set(professor.placa, {
          ...professor,
          alliberaments: [],
          convivencia: isConvivenciaProfessor(dia, hora, professor.placa),
          unavailable: isProfessorAbsentAtHour(dia, hora, professor.placa) || isAssignedElsewhere(dia, hora, professor.placa, currentAbsenceId),
        });
      });

    convivenciaProfessors(dia, hora).forEach((placa) => {
      if (placa === professorAbsent) return;
      if (candidates.has(placa)) {
        candidates.get(placa).convivencia = true;
        return;
      }
      const base = ocupacioByPlaca.get(placa) || {
        placa,
        label: labelProfessor(placa),
        sessions: [],
        classes: [],
        guardies: [],
        activitats: [],
        lliure: false,
      };
      candidates.set(placa, {
        ...base,
        alliberaments: [],
        convivencia: true,
        unavailable: isProfessorAbsentAtHour(dia, hora, placa) || isAssignedElsewhere(dia, hora, placa, currentAbsenceId),
      });
    });

    releasedItemsForSlot(dia, hora).forEach((item) => {
      if (item.placa === professorAbsent) return;

      if (!candidates.has(item.placa)) {
        const base = ocupacioByPlaca.get(item.placa) || {
          placa: item.placa,
          label: labelProfessor(item.placa),
          sessions: [],
          classes: [],
          guardies: [],
          activitats: [],
          lliure: false,
        };
        candidates.set(item.placa, {
          ...base,
          alliberaments: [],
          convivencia: isConvivenciaProfessor(dia, hora, item.placa),
          unavailable: isProfessorAbsentAtHour(dia, hora, item.placa) || isAssignedElsewhere(dia, hora, item.placa, currentAbsenceId),
        });
      }

      candidates.get(item.placa).alliberaments.push(item);
      if (isConvivenciaProfessor(dia, hora, item.placa)) candidates.get(item.placa).convivencia = true;
    });

    allProfessorIds().forEach((placa) => {
      if (placa === professorAbsent || candidates.has(placa)) return;
      const base = ocupacioByPlaca.get(placa) || {
        placa,
        label: labelProfessor(placa),
        sessions: [],
        classes: [],
        guardies: [],
        activitats: [],
        lliure: false,
      };
      candidates.set(placa, {
        ...base,
        alliberaments: [],
        convivencia: false,
        outsideDuty: true,
        unavailable: isProfessorAbsentAtHour(dia, hora, placa) || isAssignedElsewhere(dia, hora, placa, currentAbsenceId),
      });
    });

    return Array.from(candidates.values())
      .map((candidate) => ({ ...candidate, dia, hora }))
      .sort((a, b) => {
        const rankA = a.unavailable ? 4 : a.convivencia ? 2 : a.alliberaments.length ? 0 : a.outsideDuty ? 3 : 1;
        const rankB = b.unavailable ? 4 : b.convivencia ? 2 : b.alliberaments.length ? 0 : b.outsideDuty ? 3 : 1;
        if (rankA !== rankB) return rankA - rankB;
        const sourceA = a.alliberaments.length ? 'released' : a.outsideDuty ? 'other' : 'guard';
        const sourceB = b.alliberaments.length ? 'released' : b.outsideDuty ? 'other' : 'guard';
        const countDifference = guardCount(a.placa, sourceA, dia, hora) - guardCount(b.placa, sourceB, dia, hora);
        if (countDifference) return countDifference;
        return (professorShort(a.placa) || a.placa)
          .localeCompare(professorShort(b.placa) || b.placa, 'ca', { numeric: true });
      });
  }

  function allProfessorIds() {
    const ids = new Set(state.sessions.map((session) => session.placa).filter(Boolean));
    const sessionsByShort = new Map();
    state.sessions.forEach((session) => {
      if (session.placa && session.professorCurta) {
        sessionsByShort.set(normalizeSearch(session.professorCurta), session.placa);
      }
    });
    const placesByShort = new Map();
    state.referencia?.places?.forEach((place) => {
      if (place.codi && place.curta) placesByShort.set(normalizeSearch(place.curta), place.codi);
    });
    state.professoratUntis?.professors?.forEach((professor) => {
      const normalized = normalizeSearch(professor.codi);
      const placa = sessionsByShort.get(normalized) || placesByShort.get(normalized) || professor.codi;
      if (placa && !isExcludedTeacher(placa)) ids.add(placa);
    });
    return Array.from(ids).filter((teacherId) => !isExcludedTeacher(teacherId));
  }

  function isProfessorAbsentAtHour(dia, hora, placa) {
    return isTeacherAbsentAtSlot(state.absencies, dia, hora, placa);
  }

  function guardCount(placa, source = 'other', dia = '', hora = '') {
    const count = normalizeGuardCount(state.guardCounts.get(placa));
    if (source === 'released') return count.released;
    if (source === 'guard') return guardCountForSlot(count, dia, hora);
    return count.other;
  }

  function projectedGuardCountKey(placa, source, dia, hora) {
    if (!placa || !['released', 'guard'].includes(source)) return '';
    return source === 'released' ? `released|${placa}` : `guard|${dia}|${hora}|${placa}`;
  }

  function guardCountLabel(placa, source, dia, hora) {
    const count = normalizeGuardCount(state.guardCounts.get(placa));
    if (source === 'released') return `${count.released} allib.`;
    if (source === 'guard') {
      const slotCount = guardCountForSlot(count, dia, hora);
      return slotCount ? `${slotCount} G en aquesta franja` : '0 G';
    }
    return 'No té G';
  }

  function isAssignedElsewhere(dia, hora, placa, currentAbsenceId) {
    return Array.from(state.assignacions.entries()).some(([absenceId, assigned]) => {
      if (absenceId === currentAbsenceId || assigned !== placa) return false;
      const absence = state.absencies.get(absenceId);
      return absence?.dia === dia && absence?.hora === hora;
    });
  }

  function releasedItemsForDay() {
    const completeGroups = new Set(Array.from(state.grupsFora).filter((groupId) => !state.partialGroups.has(groupId)));
    const accompanyingTeachers = allCompanionTeacherIds();
    const releasedTeachers = new Map();
    completeGroups.forEach((groupId) => {
      const confirmed = state.grupProfessorsAlliberats.get(groupId) || new Set();
      releasedTeachers.set(groupId, new Set(Array.from(confirmed).filter((key) => (
        !accompanyingTeachers.has(key.split('|').slice(1).join('|'))
      ))));
    });
    return releasedTeachingBlocks({
      sessions: state.sessions,
      date: state.date,
      groupsOut: completeGroups,
      enabledTeachersByGroup: releasedTeachers,
    })
      .sort(sortCoverageItems);
  }

  function syncOutingAbsences() {
    state.outingAbsenceIds.forEach((id) => {
      state.absencies.delete(id);
      state.assignacions.delete(id);
      state.assignmentSources.delete(id);
      state.comentaris.delete(id);
    });
    state.outingAbsenceIds.clear();
    const accompanyingTeachers = new Set();
    state.grupProfessorsFora.forEach((keys) => keys.forEach((key) => accompanyingTeachers.add(key.split('|').slice(1).join('|'))));
    const day = diaXmlSeleccionat();
    accompanyingTeachers.forEach((teacherId) => {
      parser.agruparSessionsCobertura(
        state.sessions.filter((session) => session.placa === teacherId && session.dia === day && isMeaningfulSession(session)),
      ).filter(isAbsenceSelectable).forEach((item) => {
        state.absencies.set(item.id, item);
        state.outingAbsenceIds.add(item.id);
      });
    });
  }

  function releasedItemsForSlot(dia, hora) {
    return releasedItemsForDay().filter((item) => item.dia === dia && item.hora === hora);
  }

  function trimCurrentProfessorAbsences(items) {
    const valid = new Set(items.filter(isAbsenceSelectable).map((item) => item.id));
    Array.from(state.absencies.entries()).forEach(([id, item]) => {
      if (item.placa === state.professor && item.dia === diaXmlSeleccionat() && !valid.has(id)) {
        state.absencies.delete(id);
        state.assignacions.delete(id);
        state.assignmentSources.delete(id);
        state.comentaris.delete(id);
      }
    });
  }

  function clearCurrentProfessorAbsences() {
    const dia = diaXmlSeleccionat();
    Array.from(state.absencies.entries()).forEach(([id, item]) => {
      if (item.placa === state.professor && item.dia === dia) {
        state.absencies.delete(id);
        state.assignacions.delete(id);
        state.assignmentSources.delete(id);
        state.comentaris.delete(id);
      }
    });
  }

  function addAllCurrentProfessorAbsences() {
    currentProfessorDayItems()
      .filter(isAbsenceSelectable)
      .forEach((item) => {
        state.absencies.set(item.id, item);
      });
  }

  function sortCoverageItems(a, b) {
    const ordered = hoursForSelectedDay();
    const hora = ordered.indexOf(a.hora) - ordered.indexOf(b.hora);
    if (hora) return hora;
    const group = (groupLabel(a) || tipusItem(a)).localeCompare(groupLabel(b) || tipusItem(b), 'ca', { numeric: true });
    if (group) return group;
    const professor = labelProfessor(a.placa).localeCompare(labelProfessor(b.placa), 'ca', { numeric: true });
    if (professor) return professor;
    return formatMateria(a).localeCompare(formatMateria(b), 'ca', { numeric: true });
  }

  function groupBySession(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (!groups.has(item.hora)) groups.set(item.hora, []);
      groups.get(item.hora).push(item);
    });
    return Array.from(groups.entries()).map(([hora, groupItems]) => ({
      hora,
      items: groupItems.sort(sortCoverageItems),
    }));
  }

  function renderReleasedList() {
    const released = releasedItemsForDay();
    const professors = new Set(released.map((item) => item.placa));
    el.releasedCount.textContent = plural(professors.size, 'professor', 'professors');
    el.clearGroups.disabled = !state.canWrite || state.dayStatus === 'closed' || !state.grupsFora.size;

    if (!state.grupsFora.size) {
      el.releasedList.innerHTML = '<div class="empty-small">Selecciona un grup de sortida.</div>';
      return;
    }

    const releasedByHour = new Map(groupBySession(released).map((group) => [group.hora, group.items]));
    const dayHours = hoursForSelectedDay();
    el.releasedList.innerHTML = dayHours.map((hora) => {
      const items = releasedByHour.get(hora) || [];
      return `
        <section class="released-session">
          <div class="coverage-session-head">
            <h3>${escapeHtml(horaLabel(hora))}</h3>
            <span>${items.length ? plural(new Set(items.map((item) => item.placa)).size, 'professor', 'professors') : 'Sense alliberats'}</span>
          </div>
          <div class="released-session-list">
            ${items.length ? items.map(renderReleasedItem).join('') : '<div class="coverage-empty">Cap classe dels grups seleccionats.</div>'}
          </div>
        </section>
      `;
    }).join('');
  }

  function renderReleasedItem(item) {
    return `
      <article class="released-item">
        <div>
          <strong>${escapeHtml(labelProfessor(item.placa))}</strong>
          <span>${escapeHtml(formatMateria(item))} · ${escapeHtml(formatBlocCurt(item))}</span>
        </div>
      </article>
    `;
  }

  function hoursForSelectedDay() {
    const dia = diaXmlSeleccionat();
    const hores = (state.resum?.franges || [])
      .filter((franja) => franja.dia === dia)
      .map((franja) => franja.hora);
    const unique = Array.from(new Set(hores));
    if (unique.length) {
      return orderedHours(unique);
    }
    return orderedHours(state.resum?.hores || []);
  }

  function orderedHours(values) {
    return completeGuardDutyHours(values);
  }

  function sortHours(a, b) {
    if (a === b) return 0;
    const ordered = hoursForSelectedDay();
    const indexA = ordered.indexOf(a);
    const indexB = ordered.indexOf(b);
    if (indexA >= 0 && indexB >= 0) return indexA - indexB;
    if (indexA >= 0) return -1;
    if (indexB >= 0) return 1;
    return String(a || '').localeCompare(String(b || ''), 'ca', { numeric: true });
  }

  function renderCoverageRow(item) {
    const isPati = item.sessions?.some(isPatiGuardiaSession);
    const candidates = isPati ? [] : guardiesPerFranja(item.dia, item.hora, item.placa, item.id);
    const assignat = state.assignacions.get(item.id) || '';
    const coTeacher = state.assignmentSources.get(item.id) === 'co-teacher' ? assignat : '';
    const hasCandidates = candidates.length > 0;
    const hasAvailableCandidates = candidates.some((candidate) => !candidate.unavailable);
    const hasReleasedCandidates = candidates.some((candidate) => (
      !candidate.unavailable && candidate.alliberaments.length
    ));
    const comentari = state.comentaris.get(item.id) || '';
    const group = groupLabel(item) || 'Sense grup';
    const subject = formatMateria(item) || 'Sense matèria';
    const room = aulaLabel(item);
    const absentTeacherIds = item.absentTeacherIds?.length ? item.absentTeacherIds : [item.placa];
    const assignatIsConvivencia = assignat && isConvivenciaProfessor(item.dia, item.hora, assignat);
    const cancelled = state.cancelledAssignments.has(item.id);
    const taskLabel = isPati ? 'Pati · GP' : isGuardiaItem(item) ? formatMateria(item) : group;
    const printSessionDetail = isGuardiaItem(item)
      ? escapeHtml(taskLabel)
      : [
          `<strong class="print-detail-highlight">${escapeHtml(group)}</strong>`,
          escapeHtml(subject),
          room ? `<strong class="print-detail-highlight">${escapeHtml(room)}</strong>` : '',
        ].filter(Boolean).join(' · ');
    const locked = state.dayStatus === 'closed' || !state.canWrite;
    const assignmentControl = isPati
      ? '<span class="info-only-label">Informatiu · no se substitueix</span>'
      : coTeacher
        ? `<strong class="readonly-assignment assigned no-print">${escapeHtml(labelProfessor(coTeacher))}</strong><span class="co-teacher-badge no-print">Queda amb el grup</span>`
      : state.canWrite
        ? `<select data-assignacio="${escapeHtml(item.id)}" ${hasCandidates && !locked ? '' : 'disabled'}>
            <option value="">Sense preassignar</option>
            ${candidates.map((candidate) => `
              <option
                class="candidate-option ${candidateOptionClass(candidate)}"
                value="${escapeHtml(candidate.placa)}"
                ${candidate.placa === assignat ? 'selected' : ''}
                ${candidate.unavailable ? 'disabled' : ''}
              >
                ${escapeHtml(candidateSelectLabel(candidate))}
              </option>
            `).join('')}
          </select>`
        : `<strong class="readonly-assignment no-print ${assignat ? 'assigned' : 'pending'}">${escapeHtml(assignat ? labelProfessor(assignat) : 'Sense cobrir')}</strong>`;
    const commentControl = state.canWrite
      ? `<select data-comment-preset="${escapeHtml(item.id)}" aria-label="Observació preestablerta" ${locked || !state.observationPresets.length ? 'disabled' : ''}>
          <option value="">Afegeix una frase…</option>
          ${state.observationPresets.map((phrase) => `<option value="${escapeHtml(phrase)}">${escapeHtml(phrase)}</option>`).join('')}
        </select>
        <textarea data-comment="${escapeHtml(item.id)}" rows="2" placeholder="Observació lliure" ${locked ? 'disabled' : ''}>${escapeHtml(comentari)}</textarea>`
      : `<span class="readonly-comment">${escapeHtml(comentari || 'Sense observacions')}</span>`;

    return `
      <article class="coverage-item coverage-row ${assignat ? 'covered' : ''} ${cancelled ? 'not-completed' : ''} ${isPati ? 'informational' : ''}">
        <div class="coverage-professor-cell">
          <span class="cell-kicker">Absència</span>
          <strong class="no-print">${escapeHtml(absentTeacherIds.map((teacherId) => labelProfessor(teacherId)).join(' · '))}</strong>
          <strong class="print-only">${escapeHtml(absentTeacherIds.map((teacherId) => labelProfessor(teacherId, true)).join(' · '))}</strong>
          ${state.canWrite ? `<button type="button" class="icon-remove no-print" aria-label="Elimina aquesta absència" data-remove-absence="${escapeHtml(item.id)}" data-remove-absences="${escapeHtml((item.absenceIds || [item.id]).join(','))}" ${locked ? 'disabled' : ''}>X</button>` : ''}
        </div>
        <div class="coverage-detail-cell">
          <span class="cell-kicker">Sessió</span>
          <strong class="no-print coverage-group-label">${escapeHtml(taskLabel)}</strong>
          ${isGuardiaItem(item) ? '' : `<span class="no-print">${escapeHtml(subject)}</span>`}
          ${room ? `<strong class="no-print coverage-room-label">${escapeHtml(room)}</strong>` : ''}
          <span class="print-only print-session-detail">${printSessionDetail}</span>
        </div>
        <div class="coverage-assignment-cell ${hasReleasedCandidates ? 'has-released-candidates' : ''} ${hasCandidates && !hasAvailableCandidates ? 'only-unavailable' : ''}">
          ${assignmentControl}
          ${assignatIsConvivencia ? '<span class="convivencia-badge">Convivència · ús excepcional</span>' : ''}
          <span class="print-only print-assignment">${escapeHtml(assignat ? `${labelProfessor(assignat, true)}${coTeacher ? ' · Queda amb el grup' : ''}` : '')}</span>
          ${state.canWrite && assignat && !isPati && !coTeacher ? `<label class="completion-toggle no-print"><input type="checkbox" data-cancel-assignment="${escapeHtml(item.id)}" ${cancelled ? 'checked' : ''} ${locked ? 'disabled' : ''} /> No realitzada</label>` : ''}
        </div>
        <div class="coverage-comment-cell">
          ${commentControl}
          <span class="print-only" data-comment-print="${escapeHtml(item.id)}">${escapeHtml(comentari)}</span>
        </div>
      </article>
    `;
  }

  function renderCoverageItem(item) {
    const candidates = guardiesPerFranja(item.dia, item.hora, item.placa, item.id);
    const assignat = state.assignacions.get(item.id) || '';
    const hasCandidates = candidates.length > 0;
    const assignatLabel = assignat ? labelProfessor(assignat) : 'Pendent';
    const comentari = state.comentaris.get(item.id) || '';
    const details = coverageDetails(item);

    return `
      <article class="coverage-item ${assignat ? 'covered' : ''}">
        <div class="coverage-head">
          <div>
            <div class="session-title">${escapeHtml(labelProfessor(item.placa))}</div>
            <div class="session-meta">${escapeHtml(details)}</div>
          </div>
          <button type="button" class="icon-remove no-print" aria-label="Elimina aquesta absència" data-remove-absence="${escapeHtml(item.id)}">X</button>
        </div>
        <div class="assignment">
          <select data-assignacio="${escapeHtml(item.id)}" ${hasCandidates ? '' : 'disabled'}>
            <option value="">Professor/a preassignat/ada</option>
            ${candidates.map((candidate) => `
              <option
                class="candidate-option ${candidateOptionClass(candidate)}"
                value="${escapeHtml(candidate.placa)}"
                ${candidate.placa === assignat ? 'selected' : ''}
                ${candidate.unavailable ? 'disabled' : ''}
              >
                ${escapeHtml(candidateSelectLabel(candidate))}
              </option>
            `).join('')}
          </select>
          <button type="button" class="ghost" data-clear-assignacio="${escapeHtml(item.id)}">Neteja</button>
          <span class="print-only print-assignment">Guàrdia: ${escapeHtml(assignatLabel)}</span>
        </div>
        <label class="comment-field no-print">
          Comentari
          <textarea data-comment="${escapeHtml(item.id)}" rows="2" placeholder="Aula, feina, incidència...">${escapeHtml(comentari)}</textarea>
        </label>
        <div class="print-only print-comment" data-comment-print="${escapeHtml(item.id)}">${comentari ? `Comentari: ${escapeHtml(comentari)}` : ''}</div>
      </article>
    `;
  }

  function coverageDetails(item) {
    return [
      groupLabel(item),
      formatMateria(item),
      aulaLabel(item),
    ].filter(Boolean).join(' · ') || 'Sense detall';
  }

  function groupLabel(item) {
    if (item.grupsVisibles?.length) return item.grupsVisibles.join(' + ');
    if (item.cursosVisibles?.length) return item.cursosVisibles.join(' + ');
    return '';
  }

  function aulaLabel(item) {
    if (item.aulaNom) return item.aulaNom;
    return '';
  }

  function assignmentLoadLabel(item, placa) {
    const count = countAssignmentsSameSlot(item.dia, item.hora, placa);
    return plural(count, 'en aquesta hora', 'en aquesta hora');
  }

  function countAssignmentsSameSlot(dia, hora, placa) {
    let count = 0;
    state.assignacions.forEach((assignedPlaca, absenceId) => {
      if (assignedPlaca !== placa) return;
      const absence = state.absencies.get(absenceId);
      if (absence?.dia === dia && absence?.hora === hora) count += 1;
    });
    return count;
  }

  function horaLabel(hora) {
    if (hora === 'PATI') return 'Pati · 10:45–11:15';
    const normalHours = hoursForSelectedDay().filter((value) => value !== 'PATI');
    const index = normalHours.indexOf(hora);
    return index >= 0 ? `${index + 1}a hora · ${hora}` : hora;
  }

  function professorInfo(placa) {
    const sessio = (state.allSessions.length ? state.allSessions : state.sessions)
      .find((item) => item.placa === placa && (item.professorCurta || item.professorNom));
    const place = state.referencia?.places?.get(placa);
    const short = sessio?.professorCurta || place?.curta || placa;
    const aliases = new Set([placa, short, place?.curta]
      .map(normalizeSearch)
      .filter(Boolean));
    const directory = state.teacherDirectory.find((teacher) => (
      [teacher.id, teacher.codiUntis].some((alias) => aliases.has(normalizeSearch(alias)))
    ));
    const untis = state.professoratUntis?.professors?.get(short)
      || Array.from(state.professoratUntis?.professors?.values?.() || [])
        .find((professor) => normalizeSearch(professor.codi) === normalizeSearch(short));
    const directoryName = String(directory?.name || '').trim();
    const parsedName = [sessio?.professorNom, untis?.label]
      .map((name) => String(name || '').trim())
      .find((name) => name && !aliases.has(normalizeSearch(name))) || '';
    const referenceName = String(place?.descripcio || '').trim();
    return {
      short,
      name: parsedName
        || (directoryName && !aliases.has(normalizeSearch(directoryName)) ? directoryName : '')
        || referenceName,
    };
  }

  function professorShort(placa) {
    return professorInfo(placa).short || '';
  }

  function labelProfessor(placa, forcePublic = false) {
    const info = professorInfo(placa);
    const publicView = forcePublic || state.teacherView;
    if (publicView) {
      if (info.name && normalizeSearch(info.name) !== normalizeSearch(info.short || placa)) return info.name;
      return `(${info.short || info.name || placa || 'Professor/a sense nom'})`;
    }
    if (info.name && info.short && info.name !== info.short) return `${info.name} · ${info.short}`;
    if (info.name) return info.name;
    return info.short || 'Professor/a sense nom';
  }

  function isExcludedTeacher(teacherId) {
    const id = String(teacherId || '');
    if (!id) return false;
    const aliases = teacherAliasesById.get(id) || new Set([id]);
    return Array.from(aliases).some((alias) => state.excludedTeacherIds.has(alias));
  }

  function activityInfo(code) {
    const info = state.referencia?.activitats?.get(code);
    const label = info
      ? info.label || info.descripcio || 'Activitat'
      : 'Activitat';
    return { label, info };
  }

  function tipusItem(item) {
    if (isGuardiaItem(item)) return 'Guàrdia';
    if (item.activitat) return 'Activitat';
    if (!item.sessions?.some((sessio) => sessio.teClasse)) return 'Sense sessio';
    return 'Classe';
  }

  function isAbsenceSelectable(item) {
    const hasTeachingSession = item.sessions.some((sessio) => sessio.teClasse);
    return hasTeachingSession || isGuardiaItem(item);
  }

  function isGuardiaItem(item) {
    return item.sessions?.some(isGuardiaSession);
  }

  function isGuardiaSession(sessio) {
    return Boolean(
      sessio.activitatEsGuardia ||
      sessio.activitatEsGuardiaGeneral ||
      (sessio.activitat && state.guardiaCodes.has(sessio.activitat))
    );
  }

  function hasGuardiaCandidates() {
    return state.sessions.some((sessio) => (
      sessio.activitatEsGuardiaGeneral ||
      (sessio.activitat && state.guardiaCodes.has(sessio.activitat))
    ));
  }

  function formatSessionsActivitat(sessions) {
    const labels = Array.from(new Set(sessions.map((sessio) => (
      sessio.activitatCurta || sessio.activitatNom || sessio.activitat
    )).filter(Boolean)));
    return labels.length ? labels.join(', ') : 'Guàrdia';
  }

  function formatCandidateAvailability(candidate) {
    const labels = [];
    if (candidate.guardies?.length) labels.push(formatSessionsActivitat(candidate.guardies));
    if (candidate.alliberaments?.length) labels.push(formatAlliberamentLabel(candidate.alliberaments));
    if (candidate.convivencia) labels.push('Convivencia');
    return labels.length ? labels.join(' + ') : 'Disponible';
  }

  function candidateSelectLabel(candidate) {
    const source = candidate.alliberaments?.length ? 'released' : candidate.outsideDuty ? 'other' : 'guard';
    const count = guardCountLabel(candidate.placa, source, candidate.dia, candidate.hora);
    if (candidate.unavailable) {
      const reason = candidate.outsideDuty ? ' · ni G ni alliberat' : '';
      return `No disponible${reason} - ${labelProfessor(candidate.placa)}`;
    }
    if (candidate.alliberaments?.length) return `Alliberat · ${count} - ${labelProfessor(candidate.placa)}`;
    if (candidate.outsideDuty) return `Ni G ni alliberat · ${count} - ${labelProfessor(candidate.placa)}`;
    const prefix = candidate.convivencia ? 'Convivència - ' : 'Guàrdia - ';
    return `${prefix}${count} - ${labelProfessor(candidate.placa)}`;
  }

  function candidateOptionClass(candidate) {
    if (candidate.unavailable) return 'candidate-unavailable';
    if (candidate.alliberaments?.length) return 'candidate-released';
    if (candidate.outsideDuty) return 'candidate-outside-duty';
    return 'candidate-guard';
  }

  function formatAlliberamentLabel(items) {
    const grups = Array.from(new Set(items.flatMap((item) => (
      item.grupsVisibles?.length
        ? item.grupsVisibles
        : item.grups.map((grup) => `Grup ${grup}`)
    )).filter(Boolean)));
    return grups.length ? `Alliberat: ${grups.join(' + ')}` : 'Alliberat';
  }

  function formatMateria(item) {
    if (isGuardiaItem(item) && !item.materia) return 'Guàrdia';
    if (item.materia) return item.materiaCurta || item.materiaNom || 'Matèria sense nom';
    if (item.activitat) return item.activitatCurta || item.activitatNom || 'Activitat sense nom';
    return 'Sessió';
  }

  function formatBlocCurt(item) {
    const parts = [];
    if (item.grupsVisibles?.length) parts.push(item.grupsVisibles.join(' + '));
    else if (item.grups.length) parts.push('Grup sense nom');
    else if (item.cursosVisibles?.length) parts.push(item.cursosVisibles.join(' + '));
    else if (item.cursos.length) parts.push('Curs sense nom');
    if (item.aulaNom) parts.push(item.aulaNom);
    else if (item.aula) parts.push('Aula sense nom');
    return parts.join(' · ') || 'Sense grup';
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function plural(count, singular, pluralText) {
    return `${count} ${count === 1 ? singular : pluralText}`;
  }

  function diaXmlSeleccionat() {
    return xmlDayForDate(state.date);
  }

  function setDateToXmlDay(xmlDay) {
    const date = dateForXmlDayInSameWeek(state.date, xmlDay);
    if (!date) return;
    state.changeDate(date);
  }

  function localDateString(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatData(value) {
    if (!value) return 'Sense data';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ca-ES', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
