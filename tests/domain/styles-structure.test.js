import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const root = postcss.parse(readFileSync(new URL('../../labs/guardies/styles.css', import.meta.url), 'utf8'));
const topLevel = root.nodes.filter((node) => node.type !== 'comment');

test('els estils declaren les capes en ordre i no deixen cap regla fora de capa', () => {
  const [order, ...blocks] = topLevel;
  assert.equal(order.type, 'atrule');
  assert.equal(order.name, 'layer');
  assert.equal(order.params.replace(/\s+/g, ' '), 'tokens, legacy, redesign, print');
  // Una regla sense capa guanyaria a totes les capes i trencaria l'ordre.
  blocks.forEach((node) => {
    assert.equal(node.type, 'atrule', `regla fora de capa: ${node.selector || node.name}`);
    assert.equal(node.name, 'layer', `bloc fora de capa: @${node.name} ${node.params}`);
  });
  assert.deepEqual(blocks.map((node) => node.params), ['tokens', 'legacy', 'redesign', 'print']);
});

test('la impressió només conté regles d\'impressió i el redisseny té escala tipogràfica', () => {
  const layer = (name) => topLevel.find((node) => node.params === name);
  layer('print').each((node) => {
    assert.ok(node.type === 'comment' || (node.name === 'media' && /\bprint\b/.test(node.params)), 'la capa print només admet @media print');
  });
  const rawSizes = [];
  layer('redesign').walkDecls('font-size', (decl) => { if (/^[\d.]+(rem|px)$/.test(decl.value.trim())) rawSizes.push(`${decl.parent.selector}: ${decl.value}`); });
  assert.deepEqual(rawSizes, [], 'el redisseny fa servir la variable --text-* en lloc de mides fixes');
});
