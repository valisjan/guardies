import { expect, test } from '@playwright/test';

test('keyed rendering retains controls, focus and listeners when rows reorder', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createKeyedRenderer } = await import('/src/utils/keyedDom.js');
    const root = document.createElement('div');
    document.body.append(root);
    const render = createKeyedRenderer(root);
    const row = (id, value) => `<article data-coverage-row="${id}"><textarea data-comment="${id}">${value}</textarea></article>`;
    render(row('a', 'Text') + row('b', 'Segon'), 'day-1');
    const editor = root.querySelector('[data-comment="a"]');
    let calls = 0;
    editor.addEventListener('input', () => calls++);
    editor.focus();
    editor.value = 'Text amb espais  ';
    editor.setSelectionRange(5, 9);
    render(row('b', 'Canvi remot') + row('a', 'Text amb espais'), 'day-1');
    editor.dispatchEvent(new Event('input'));
    const retained = { sameControl: root.querySelector('[data-comment="a"]') === editor,
      focus: document.activeElement === editor, value: editor.value, selection: [editor.selectionStart, editor.selectionEnd],
      order: Array.from(root.children, (node) => node.dataset.coverageRow), calls };
    render(row('a', 'Text amb espais'), 'day-1');
    const afterRemoval = root.querySelector('[data-comment="a"]') === editor && root.children.length === 1;
    render(row('b', 'Segon') + row('a', 'Text amb espais'), 'day-1');
    render(row('a', 'Text amb espais') + row('b', 'Segon'), 'day-1');
    const focusedRowMoved = document.activeElement === editor;
    render(row('a', 'Altre dia'), 'day-2');
    return { retained, afterRemoval, focusedRowMoved, resetOnNavigation: root.querySelector('[data-comment="a"]') !== editor };
  });
  expect(result).toEqual({ retained: { sameControl: true, focus: true, value: 'Text amb espais  ', selection: [5, 9], order: ['b', 'a'], calls: 1 },
    afterRemoval: true, focusedRowMoved: true, resetOnNavigation: true });
});

test('keyed rendering applies remote values and locks existing controls', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createKeyedRenderer } = await import('/src/utils/keyedDom.js');
    const root = document.createElement('div');
    document.body.append(root);
    const render = createKeyedRenderer(root);
    const view = (locked) => `<article data-coverage-row="a"><textarea data-comment="a" ${locked ? 'disabled' : ''}>${locked ? 'Remot' : 'Inicial'}</textarea>
      <select data-assignacio="a" ${locked ? 'disabled' : ''}><option value="a" ${locked ? '' : 'selected'}>A</option><option value="b" ${locked ? 'selected' : ''}>B</option></select>
      <input type="checkbox" ${locked ? 'checked disabled' : ''}></article>`;
    render(view(false), 'day');
    const editor = root.querySelector('textarea');
    editor.focus();
    editor.setSelectionRange(2, 5);
    render(view(true), 'day');
    return { sameEditor: root.querySelector('textarea') === editor, value: editor.value, locked: editor.disabled,
      selected: root.querySelector('select').value, checked: root.querySelector('input').checked };
  });
  expect(result).toEqual({ sameEditor: true, value: 'Remot', locked: true, selected: 'b', checked: true });
});

test('keyed rendering does not overwrite text during IME composition', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createKeyedRenderer } = await import('/src/utils/keyedDom.js');
    const root = document.createElement('div');
    document.body.append(root);
    const render = createKeyedRenderer(root);
    const view = (text) => `<article data-coverage-row="a"><textarea data-comment="a">${text}</textarea></article>`;
    render(view('Inicial'), 'day');
    const editor = root.querySelector('textarea');
    editor.focus();
    editor.value = 'Composició';
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    render(view('Remot'), 'day');
    const during = editor.value;
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    render(view('Remot'), 'day');
    return { during, after: editor.value, sameEditor: root.querySelector('textarea') === editor };
  });
  expect(result).toEqual({ during: 'Composició', after: 'Remot', sameEditor: true });
});
