import test from 'node:test';
import assert from 'node:assert/strict';
import { findDirectoryTeacher, isActiveTeacherRecord } from '../../src/modules/guardies/domain/teacherDirectory.js';

// Cas real (28/10/2026): Capellà substitueix Torres a la plaça TORR; la fitxa de Torres,
// de baixa, conserva el codi Untis TORR i sortia primer.
const torres = {
  id: '1syXbIyNBg5Yh25x7ro2', codiUntis: 'TORR', nom: 'TORRES ROMAGOSA, ANNA', email: 'atorres@iesjosepsuredaiblanes.com',
  substitutId: 'TORR', substituitPer: 'CAPELLÀ ROIG, MARIA ASSUMPCIÓ', motiuBaixa: 'Baixa', desactivatAt: '2026-10-20T13:34:55.095Z', eliminatDelFull: true,
};
const capella = { id: 'TORR', codiUntis: 'TORR', nom: 'CAPELLÀ ROIG, MARIA ASSUMPCIÓ', email: 'acapella@iesjosepsuredaiblanes.com', eliminatDelFull: false };

test('una fitxa de baixa, desactivada o treta del professorat no compta', () => {
  assert.equal(isActiveTeacherRecord(capella), true);
  assert.equal(isActiveTeacherRecord(torres), false);
  assert.equal(isActiveTeacherRecord({ motiuBaixa: 'Baixa' }), false);
  assert.equal(isActiveTeacherRecord({ desactivatAt: '2026-10-20T13:34:55Z' }), false);
  assert.equal(isActiveTeacherRecord({ eliminatDelFull: true }), false);
  assert.equal(isActiveTeacherRecord({ motiuBaixa: '  ' }), true);
});

test('amb dues fitxes amb el mateix codi Untis, el correu és el de qui ocupa la plaça', () => {
  const directory = [torres, capella].map((teacher) => ({ ...teacher, active: isActiveTeacherRecord(teacher) }));
  assert.equal(findDirectoryTeacher(directory, ['9401', 'TORR'])?.email, 'acapella@iesjosepsuredaiblanes.com');
  // Encara que la de baixa no estigués marcada, l'identificador de la plaça passa davant del codi.
  const unmarked = [{ ...torres, active: true }, { ...capella, active: true }];
  assert.equal(findDirectoryTeacher(unmarked, ['torr'])?.email, 'acapella@iesjosepsuredaiblanes.com');
});

test('si cap fitxa té l\'identificador, val la del codi Untis (sense accents ni majúscules)', () => {
  const salinas = { id: 'SALI', codiUntis: 'PRO1', email: 'jrsalinas@iesjosepsuredaiblanes.com' };
  assert.equal(findDirectoryTeacher([salinas], ['pro1'])?.email, 'jrsalinas@iesjosepsuredaiblanes.com');
  assert.equal(findDirectoryTeacher([{ id: 'X', codiUntis: 'CÀRR' }], ['CARR'])?.id, 'X');
  assert.equal(findDirectoryTeacher([salinas], ['ZZZZ']), null);
});
