import { expect, test } from '@playwright/test';

test('benchmark: repeated coverage redraws retain editing controls', async ({ page }, testInfo) => {
  test.skip(!process.env.GUARDIES_BENCHMARK, 'Opt-in repeatable performance measurement');
  await page.addInitScript(() => {
    const teachers = Array.from({ length: 60 }, (_, i) => `P${i}`);
    const file = (text, name) => ({ text, name, size: text.length });
    localStorage.setItem('quota-e2e-guardies:e2e-2026', JSON.stringify({
      files: {
        reference: file(`<CENTRE codi="TEST" any="2026"><PLACES>${teachers.map((t) => `<PLACA codi="${t}" curta="${t}" />`).join('')}</PLACES></CENTRE>`, 'reference.xml'),
        untis: file(teachers.map((t) => `${t},"Professor ${t}"`).join('\n'), 'GPU004.TXT'),
        duties: file(teachers.flatMap((teacher, i) => Array.from({ length: 4 }, (_, slot) =>
          `${i * 4 + slot + 1},"${i >= 50 ? '' : `G${i}`}","${teacher}","${i >= 50 ? 'G' : 'MAT'}","A${i}",1,${slot + 1},,`)).join('\n'), 'GPU001.TXT'),
      },
      stats: { counts: {}, guardHistory: {}, guardHistoryVersion: 1 },
    }));
  });
  await page.goto('/?data=2026-09-07');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.evaluate(async () => {
    const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
    const parser = await import('/labs/guardies/horariXmlParser.js');
    const store = useGuardiesStore();
    const blocks = parser.agruparSessionsCobertura(store.sessions.filter((s) => Number(s.placa.slice(1)) < 5 && s.teClasse));
    blocks.forEach((item) => store.absencies.set(item.id, item));
    window.dispatchEvent(new CustomEvent('guardies:day-edited'));
  });
  await expect(page.locator('[data-assignacio]')).toHaveCount(20);
  await expect.poll(() => page.evaluate(async () => {
    const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
    return useGuardiesStore().dayRevision;
  })).toBeGreaterThan(0);
  await page.locator('[data-comment]').first().fill('Observació local');
  await page.waitForTimeout(350);
  const result = await page.evaluate(() => {
    const root = document.getElementById('coverage-list');
    const input = root.querySelector('[data-comment]');
    input.focus();
    input.setSelectionRange(3, 8);
    const observer = new MutationObserver(() => {});
    observer.observe(root, { childList: true, subtree: true });
    const samples = [];
    let addedNodes = 0;
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
      samples.push(performance.now() - start);
      addedNodes += observer.takeRecords().reduce((sum, record) => sum + record.addedNodes.length, 0);
    }
    observer.disconnect();
    const sorted = samples.slice(2).sort((a, b) => a - b);
    return { rows: root.querySelectorAll('[data-assignacio]').length, redrawMedianMs: sorted[5], addedNodes,
      sameControl: root.querySelector('[data-comment]') === input, focusRetained: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd] };
  });
  console.log('GUARDIES_REDRAW_BENCHMARK', JSON.stringify(result));
  await testInfo.attach('redraw-benchmark', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.sameControl).toBe(true);
  expect(result.focusRetained).toBe(true);
  expect(result.selection).toEqual([3, 8]);
});

// Same synthetic workload before/after; no production Firebase traffic.
test('benchmark: exclusions and reopening a published day', async ({ page }, testInfo) => {
  test.skip(!process.env.GUARDIES_BENCHMARK, 'Opt-in repeatable performance measurement');
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const key = 'quota-e2e-guardies:e2e-2026';
    if (!localStorage.getItem(key)) {
      const teachers = Array.from({ length: 160 }, (_, i) => `P${i}`);
      const lines = teachers.flatMap((teacher, i) => Array.from({ length: 30 }, (_, slot) =>
        `${i * 30 + slot + 1},"${slot % 6 === 5 ? '' : `G${i}`}","${teacher}","${slot % 6 === 5 ? 'G' : 'MAT'}","A${i}",${Math.floor(slot / 6) + 1},${slot % 6 + 1},,`));
      const file = (text, name) => ({ text, name, size: text.length });
      localStorage.setItem(key, JSON.stringify({
        files: {
          reference: file(`<CENTRE codi="TEST" any="2026"><PLACES>${teachers.map((t) => `<PLACA codi="${t}" curta="${t}" />`).join('')}</PLACES></CENTRE>`, 'reference.xml'),
          untis: file(teachers.map((t) => `${t},"Professor ${t}"`).join('\n'), 'GPU004.TXT'),
          duties: file(lines.join('\n'), 'GPU001.TXT'),
        },
        stats: { counts: {}, guardHistory: {}, guardHistoryVersion: 1 },
        days: { '2026-09-07': { date: '2026-09-07', status: 'closed', revision: 1, absenceIds: [], assignments: {}, comments: {}, groupsOut: [], clientUpdatedAt: '2026-09-07T08:00:00Z' } },
      }));
    }
    window.__benchmark = { xmlParses: 0, appWrites: 0 };
    const parse = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (...args) {
      window.__benchmark.xmlParses++;
      return parse.apply(this, args);
    };
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) window.__benchmark.appWrites++;
      return set.call(this, name, value);
    };
  });
  await page.goto('/?data=2026-09-07');
  await expect(page.locator('#workspace')).toBeVisible();
  // Allow initial legacy public-projection repair, then measure reopen separately.
  await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).publicDays?.['2026-09-07']))).toBe(true);
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
    const store = useGuardiesStore();
    const reopenWrites = window.__benchmark.appWrites;
    const beforeParses = window.__benchmark.xmlParses;
    const samples = [];
    for (let i = 0; i < 12; i++) {
      if (i % 2) store.excludedTeacherIds.delete('P159');
      else store.excludedTeacherIds.add('P159');
      const start = performance.now();
      window.dispatchEvent(new CustomEvent('guardies:exclusions-updated'));
      samples.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { sessions: store.sessions.length, reopenWrites, exclusionXmlParses: window.__benchmark.xmlParses - beforeParses, samples };
  });
  expect(result.sessions).toBe(4800);
  const sorted = result.samples.slice(2).sort((a, b) => a - b);
  result.exclusionMedianMs = sorted[Math.floor(sorted.length / 2)];
  console.log('GUARDIES_BENCHMARK', JSON.stringify(result));
  await testInfo.attach('benchmark', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
