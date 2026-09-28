import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeUploadedText, hasEncodingDamage } from '../../src/utils/decodeText.js';

const line = '388,,"CAÑE",,,4,3,,\r\n1,"2ESO-A","FQ1","FQ-A-2E","L.QUÍ~AUL09",4,4,,';
const windows1252 = Uint8Array.from(line, (char) => char.charCodeAt(0)).buffer;

test('llegeix fitxers d\'Untis en Windows-1252 sense perdre accents ni la Ñ', () => {
  const text = decodeUploadedText(windows1252);
  assert.equal(text, line);
  assert.equal(hasEncodingDamage(text), false);
});

test('llegeix UTF-8, amb o sense BOM, i UTF-16', () => {
  const utf8 = new TextEncoder().encode(line);
  assert.equal(decodeUploadedText(utf8.buffer), line);
  assert.equal(decodeUploadedText(Uint8Array.from([0xEF, 0xBB, 0xBF, ...utf8]).buffer), line);
  const utf16 = new Uint8Array(2 + line.length * 2);
  utf16.set([0xFF, 0xFE]);
  [...line].forEach((char, index) => { utf16[2 + index * 2] = char.charCodeAt(0); });
  assert.equal(decodeUploadedText(utf16.buffer), line);
});

test('respecta la codificació declarada a l\'XML', () => {
  const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><CENTRE><PLACA curta="CAÑE"/></CENTRE>';
  assert.equal(decodeUploadedText(Uint8Array.from(xml, (char) => char.charCodeAt(0)).buffer), xml);
});

test('detecta un fitxer desat amb caràcters perduts', () => {
  assert.equal(hasEncodingDamage('"CA�E"'), true);
  assert.equal(hasEncodingDamage(''), false);
});
