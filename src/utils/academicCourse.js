export function academicCourseIdForDate(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 8 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export function selectDefaultAcademicCourse(courses = [], date = new Date()) {
  const currentCourseId = academicCourseIdForDate(date);
  return courses.find((course) => course.id === currentCourseId)
    || courses.find((course) => !course.bloqueig)
    || courses[0]
    || null;
}
