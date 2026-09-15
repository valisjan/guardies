import { defineStore } from 'pinia';

export const GUARD_CODES_STORAGE = 'quota_guardies_lab_codes';

function localDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function loadGuardCodes() {
  try {
    const stored = JSON.parse(localStorage.getItem(GUARD_CODES_STORAGE) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

export const useGuardiesStore = defineStore('guardies', {
  state: () => ({
    referenceText: '',
    referenceName: '',
    untisText: '',
    untisName: '',
    dutiesText: '',
    dutiesName: '',
    referencia: null,
    professoratUntis: null,
    sessions: [],
    allSessions: [],
    professorOptions: [],
    allProfessorOptions: [],
    teacherDirectory: [],
    excludedTeacherIds: new Set(),
    resum: null,
    patiConfig: null,
    professor: '',
    date: localDateString(new Date()),
    guardiaCodes: loadGuardCodes(),
    convivencia: new Map(),
    observationPresets: [],
    absencies: new Map(),
    assignacions: new Map(),
    assignmentSources: new Map(),
    comentaris: new Map(),
    grupsFora: new Set(),
    grupProfessorsFora: new Map(),
    grupProfessorsAlliberats: new Map(),
    partialGroups: new Set(),
    outingAbsenceIds: new Set(),
    courseId: '',
    courseName: '',
    canWrite: false,
    isAdmin: false,
    teacherView: false,
    adminSection: 'daily',
    teacherSection: 'daily',
    contextReady: false,
    authRequired: false,
    viewerName: '',
    viewerEmail: '',
    persistenceStatus: 'loading',
    dayRevision: 0,
    dayLoaded: false,
    dayPersistenceStatus: 'idle',
    dayStatus: 'draft',
    publishedAt: '',
    updatedAt: '',
    closedAt: '',
    cancelledAssignments: new Set(),
    guardCounts: new Map(),
    countedAssignments: [],
    unclosedDays: [],
  }),
  actions: {
    clearAbsencePlan() {
      this.absencies.clear();
      this.assignacions.clear();
      this.assignmentSources.clear();
      this.comentaris.clear();
      this.cancelledAssignments.clear();
      this.outingAbsenceIds.clear();
    },
    clearGroupsOut() {
      this.grupsFora.clear();
      this.grupProfessorsFora.clear();
      this.grupProfessorsAlliberats.clear();
      this.partialGroups.clear();
      this.outingAbsenceIds.clear();
    },
    clearDayContext() {
      this.clearAbsencePlan();
      this.clearGroupsOut();
      this.dayStatus = 'draft';
      this.publishedAt = '';
      this.updatedAt = '';
      this.closedAt = '';
      this.cancelledAssignments.clear();
      this.countedAssignments = [];
    },
    changeDate(date) {
      if (!date || date === this.date) return;
      this.date = date;
      this.clearDayContext();
      const url = new URL(window.location.href);
      url.searchParams.set('data', date);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    },
  },
});
