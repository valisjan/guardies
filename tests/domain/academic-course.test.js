import test from 'node:test';
import assert from 'node:assert/strict';
import {
  academicCourseIdForDate,
  selectDefaultAcademicCourse,
} from '../../src/utils/academicCourse.js';

test('calcula el curs acadèmic vigent a partir de setembre', () => {
  assert.equal(academicCourseIdForDate(new Date(2026, 8, 6)), '2026-2027');
  assert.equal(academicCourseIdForDate(new Date(2027, 1, 1)), '2026-2027');
});

test('prioritza el curs vigent encara que hi hagi un curs futur desbloquejat', () => {
  const courses = [
    { id: '2027-2028', bloqueig: false },
    { id: '2026-2027', bloqueig: false },
  ];

  assert.equal(
    selectDefaultAcademicCourse(courses, new Date(2026, 8, 6))?.id,
    '2026-2027',
  );
});

test('manté el primer curs desbloquejat si el vigent no existeix', () => {
  const courses = [
    { id: '2027-2028', bloqueig: true },
    { id: '2025-2026', bloqueig: false },
  ];

  assert.equal(
    selectDefaultAcademicCourse(courses, new Date(2026, 8, 6))?.id,
    '2025-2026',
  );
});
