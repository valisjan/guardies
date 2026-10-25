import assert from 'node:assert/strict';
import test from 'node:test';
import { isSamePerson, nameTokens } from '../../src/modules/guardies/domain/names.js';

test('reconeix la mateixa persona amb el nom en un altre ordre o sense accents', () => {
  assert.deepEqual(nameTokens('Adell Domènech, Marina'), ['adell', 'domenech', 'marina']);
  assert.equal(isSamePerson('Marina Adell Domènech', 'Adell Domènech, Marina'), true);
  assert.equal(isSamePerson('MARINA ADELL DOMENECH', 'Adell Domènech, Marina'), true);
  // El compte sovint no porta el segon llinatge.
  assert.equal(isSamePerson('Gabriel Fuentes', 'Fuentes Serra, Gabriel'), true);
});

test('no confon persones diferents ni noms massa curts', () => {
  assert.equal(isSamePerson('Gabriel Fuentes', 'Sanz Vidal, Clara'), false);
  assert.equal(isSamePerson('Marina', 'Adell Domènech, Marina'), false);
  assert.equal(isSamePerson('Joan Pons', 'Pons Mas Ferrer, Joan'), false);
  assert.equal(isSamePerson('', 'Adell Domènech, Marina'), false);
  assert.equal(isSamePerson('Marina Adell', ''), false);
});
