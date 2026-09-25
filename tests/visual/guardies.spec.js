import { expect, test } from '@playwright/test';

const referenceXml = `<?xml version="1.0" encoding="UTF-8"?>
<CENTRE codi="E2E" any="2026">
  <CURSOS>
    <CURS codi="1" descripcio="1r ESO">
      <GRUP codi="10" nom="A" />
      <GRUP codi="11" nom="B" />
    </CURS>
  </CURSOS>
  <PLACES>
    <PLACA codi="1" curta="ADEL" />
    <PLACA codi="2" curta="FUEN" />
    <PLACA codi="3" curta="SANZ" />
    <PLACA codi="4" curta="MAT1" />
  </PLACES>
  <MATERIES>
    <MATERIA codi="100" curs="1" descripcio="Matemàtiques" curta="MAT" />
  </MATERIES>
  <ACTIVITATS>
    <ACTIVITAT codi="200" descripcio="Guàrdia" curta="G" />
  </ACTIVITATS>
  <AULES>
    <AULA codi="300" descripcio="Aula 14" />
  </AULES>
</CENTRE>`;

const teachersText = `ADEL,"Adell Domènech, Marina"
FUEN,"Fuentes Serra, Gabriel"
SANZ,"Sanz Vidal, Clara"`;

const dutiesText = `10,"1ESO-A","ADEL","MAT","AUL14",1,1,,
11,"1ESO-A","ADEL","MAT","AUL14",1,2,,
12,"1ESO-A","MAT1","MAT","AUL14",1,1,,
12,"1ESO-B","MAT1","MAT","AUL14",1,1,,
1,,"ADEL","G",,1,3,,
2,,"FUEN","G",,1,1,,
3,,"SANZ","G",,1,2,,
5,,"SANZ","G",,1,1,,
4,,"FUEN","GP",,1,4,,
13,"1ESO-B","MAT1","MAT","AUL14",1,3,,
20,"1ESO-A","ADEL","MAT","AUL14",2,5,,`;

const referenceFile = {
  name: 'gestib-e2e.xml',
  mimeType: 'application/xml',
  buffer: Buffer.from(referenceXml),
};

const teachersFile = {
  name: 'GPU004.TXT',
  mimeType: 'text/plain',
  buffer: Buffer.from(teachersText),
};

const dutiesFile = {
  name: 'GPU001.TXT',
  mimeType: 'text/plain',
  buffer: Buffer.from(dutiesText),
};

const sharedDutiesFile = {
  name: 'GPU001.TXT',
  mimeType: 'text/plain',
  buffer: Buffer.from(`${dutiesText}\n14,"1ESO-A","FUEN","MAT","AUL14",1,2,,`),
};

const sevenSessionsDutiesFile = {
  name: 'GPU001.TXT',
  mimeType: 'text/plain',
  buffer: Buffer.from(`${dutiesText}\n21,"1ESO-A","ADEL","MAT","AUL14",1,6,,\n22,"1ESO-A","ADEL","MAT","AUL14",1,7,,`),
};

async function openGuardies(page) {
  await page.goto('/?data=2026-09-07');
  await expect(page.locator('#cache-info')).toContainText('E2E 2026-27');
}

async function uploadConfiguration(page) {
  await page.getByRole('tab', { name: 'Configuració' }).click();
  await page.locator('#reference-file').setInputFiles(referenceFile);
  await expect(page.locator('[data-upload-status="reference"]')).toHaveText('OK');

  await page.locator('#untis-file').setInputFiles(teachersFile);
  await expect(page.locator('[data-upload-status="untis"]')).toHaveText('OK');

  await page.locator('#duties-file').setInputFiles(dutiesFile);
  await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
  await page.getByRole('tab', { name: 'Gestió diària' }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#print-coverage')).toBeEnabled();
}

test.describe('Guàrdies: comportament existent', () => {
  test('mostra la jornada pública sense carregar horaris ni recompte', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('quota-e2e-guardies:e2e-2026', JSON.stringify({ publicDays: {
        '2026-09-07': { date: '2026-09-07', status: 'published', hours: [{
          label: '1a hora', rows: [{ absent: 'Anna', group: '1ESO-A', assigned: 'Joan', comment: 'Biblioteca' }],
        }], groupsOut: [] },
      } }));
    });
    await page.goto('/?vista=professor&data=2026-09-07');
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('.readonly-assignment')).toHaveText('Joan');
    await expect(page.locator('#coverage-list')).toContainText('Biblioteca');
    expect(await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const state = useGuardiesStore();
      return { sessions: state.sessions.length, stats: state.teacherStatsStatus };
    })).toEqual({ sessions: 0, stats: 'idle' });
    await page.evaluate(() => {
      const key = 'quota-e2e-guardies:e2e-2026';
      localStorage.setItem(key, '{}');
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Jornada encara no publicada' })).toBeVisible();
  });

  test('conserva la data i els canvis locals si el guardat entra en conflicte', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.revision || 0)).toBeGreaterThan(0);
    await page.locator('[data-comment]').first().evaluate((input) => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.days['2026-09-07'].revision += 1;
      localStorage.setItem(key, JSON.stringify(data));
      input.value = 'Conserva aquest canvi';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: '2026-09-08' } }));
    });
    await expect(page.locator('#error-box')).toContainText('No s’ha pogut guardar'.replace('’', "'"));
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await expect(page.locator('[data-comment]').first()).toHaveValue('Conserva aquest canvi');
    page.once('dialog', (dialog) => dialog.accept());
    await page.reload();
    await expect(page.locator('.day-conflict')).toBeVisible();
    await expect(page.locator('[data-comment]').first()).toHaveValue('Conserva aquest canvi');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Carrega la compartida' }).click();
    await expect(page.locator('.day-conflict')).toHaveCount(0);
    await expect(page.locator('[data-comment]').first()).not.toHaveValue('Conserva aquest canvi');
  });

  test('conserva una edició feta mentre arriba la jornada del servidor', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(async () => {
      const { saveGuardiesDay } = await import('/src/services/guardiesStorage.js');
      await saveGuardiesDay('e2e-2026', '2026-09-07', { status: 'draft', comments: { __pati_observation__: 'Servidor' } }, 0);
    });
    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      window.dispatchEvent(new CustomEvent('guardies:legacy-render', { detail: { reloadDay: true } }));
      const state = useGuardiesStore();
      state.comentaris.set('__pati_observation__', 'Edició durant la càrrega');
    });
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().comentaris.get('__pati_observation__');
    })).toBe('Edició durant la càrrega');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.comments?.__pati_observation__)).toBe('Edició durant la càrrega');
  });

  test('no descarta el canvi local quan arriba una versió remota pendent', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.revision || 0)).toBeGreaterThan(0);
    const absenceId = await page.locator('[data-comment]').first().evaluate((input) => {
      input.value = 'Comentari local';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.days['2026-09-07'].revision += 1;
      data.days['2026-09-07'].comments[input.dataset.comment] = 'Comentari remot';
      localStorage.setItem(key, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent('storage', { key }));
      return input.dataset.comment;
    });
    await expect(page.locator('.day-conflict')).toBeVisible();
    await page.waitForTimeout(350);
    await expect(page.locator('[data-comment]').first()).toHaveValue('Comentari local');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Conserva la meva versió' }).click();
    await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].comments[id], absenceId)).toBe('Comentari local');
    await expect(page.locator('.day-conflict')).toHaveCount(0);
  });

  test('reconstrueix G conservant tots els grups i ignorant assignacions cancel·lades', async ({ page }) => {
    await openGuardies(page);
    const history = await page.evaluate(async () => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key)) || {};
      data.stats = { counts: {}, guardHistoryVersion: 0 };
      data.days = { '2026-09-07': {
        status: 'closed', cancelledAssignments: ['c'],
        assignments: {
          a: { teacherId: '2', source: 'guard' },
          b: { teacherId: '2', source: 'guard' },
          c: { teacherId: '2', source: 'guard' },
          d: { teacherId: '3', source: 'released' },
        },
      } };
      localStorage.setItem(key, JSON.stringify(data));
      const { rebuildGuardiesGuardHistory } = await import('/src/services/guardiesStorage.js');
      const result = await rebuildGuardiesGuardHistory('e2e-2026', {
        a: { groups: ['1ESO-A'] }, b: { groups: ['2ESO-B'] }, c: { groups: ['3ESO-C'] },
      });
      const repeated = await rebuildGuardiesGuardHistory('e2e-2026', {});
      return { first: result.guardHistory, repeated: repeated.guardHistory };
    });
    expect(history.first).toEqual({ 2: { '2026-09-07': ['1ESO-A', '2ESO-B'] } });
    expect(history.repeated).toEqual(history.first);
  });

  test('desa el comentari al dia original en canviar immediatament de data', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await page.locator('[data-comment]').first().evaluate((input) => {
      input.value = 'Feina pendent';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: '2026-09-08' } }));
    });
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    const days = await page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days);
    expect(Object.values(days['2026-09-07'].comments)).toContain('Feina pendent');
    expect(Object.values(days['2026-09-08']?.comments || {})).not.toContain('Feina pendent');
  });

  test('actualitza recomptes sense reconstruir les sessions del horari', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const store = useGuardiesStore();
      window.sessionsBeforeStats = store.sessions;
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats = { counts: { 2: { guard: 3 } }, guardHistoryVersion: 1 };
      localStorage.setItem(key, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().guardCounts.get('2')?.guard;
    })).toBe(3);
    expect(await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().sessions === window.sessionsBeforeStats;
    })).toBe(true);
  });

  test('mostra les dates G del professor en passar-hi per damunt', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats = {
        ...(data.stats || {}),
        guardHistoryVersion: 1,
        guardHistory: { 2: { '2026-09-18': ['1ESO-A'] } },
      };
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.reload();
    await page.goto('/?data=2026-09-07&vista=professor');
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    const teacher = page.locator('[data-roster-teacher="2"]').first();
    await teacher.hover();
    await expect(teacher.locator('.guard-history-tooltip')).toBeVisible();
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('1 guàrdia');
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('18/09/2026');
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('1ESO-A');
  });

  test('arrenca buit i obliga a carregar els fitxers en ordre', async ({ page }) => {
    await openGuardies(page);

    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Guàrdies', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Professorat', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Gestió diària' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-panel')).toBeHidden();
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('#reference-file')).toBeEnabled();
    await expect(page.locator('#untis-file')).toBeDisabled();
    await expect(page.locator('#duties-file')).toBeDisabled();
    await expect(page.locator('#xml-file')).toHaveCount(0);
    await expect(page.locator('#cache-info')).toContainText('0/3 fitxers compartits');
    await expect(page.locator('#admin-panel')).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('carrega la configuració i la conserva després de recarregar', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);

    await expect(page.locator('#stat-sessions')).not.toHaveText('0');
    await expect(page.locator('#stat-reference')).toHaveText('Sí');
    await expect(page.locator('#cache-info')).toContainText('3/3 fitxers compartits');

    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await expect(page.locator('[data-upload-name="reference"]')).toHaveText('gestib-e2e.xml');
    await expect(page.locator('[data-upload-name="untis"]')).toHaveText('GPU004.TXT');
    await expect(page.locator('[data-upload-name="duties"]')).toHaveText('GPU001.TXT');
    await expect(page.locator('[data-upload-name="schedule"]')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await expect(page.locator('#schedule-grid')).toContainText('Aula 14');
    await expect(page.locator('#schedule-grid')).not.toContainText('AUL14');

    await page.getByRole('button', { name: 'Dia següent' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    await page.getByRole('button', { name: 'Dia anterior' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');

    await page.locator('#date-input').fill('2026-09-11');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('button', { name: 'Dia següent' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-14');
    await page.getByRole('button', { name: 'Dia anterior' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-11');
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');

    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await expect(page).toHaveURL(/vista=professor/);
    await expect(page).toHaveURL(/data=2026-09-07/);
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await page.getByRole('link', { name: 'Guàrdies', exact: true }).click();
    await expect(page).toHaveURL(/data=2026-09-07/);
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Jornada encara no publicada' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Guàrdies del dia' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.teacher-stats-panel')).toBeHidden();
    expect(await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const state = useGuardiesStore();
      return { sessions: state.sessions.length, stats: state.teacherStatsStatus };
    })).toEqual({ sessions: 0, stats: 'idle' });
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('.teacher-stats-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Guàrdies del dia' }).click();
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Professorat', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('avisa de les jornades passades que encara no estan tancades', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2020-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid [data-absence]:not(:disabled)').first().check();
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('.unclosed-days-warning')).toContainText('Dies no tancats:');
    await expect(page.locator('.unclosed-days-warning')).toContainText('07/09/2020');
    await expect(page.locator('.unclosed-days-warning + .work-header')).toBeVisible();
    await page.getByRole('button', { name: 'Tanca jornada' }).click();
    await expect(page.locator('.unclosed-days-warning')).toBeHidden();
  });

  test('permet corregir manualment els recomptes de G i alliberat', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#guard-counts-panel summary').click();
    await page.locator('#guard-count-search').fill('Fuentes');
    const releasedInput = page.getByLabel('Guàrdies com a alliberat de Fuentes Serra, Gabriel');
    await releasedInput.fill('4');
    await releasedInput.press('Tab');
    await expect(page.locator('#guard-counts-panel')).toContainText('Desat');
    await expect(page.locator('#guard-count-slot')).toHaveValue('1|8:00');
    const countRow = page.locator('.guard-count-row').filter({ hasText: 'Fuentes Serra' });
    await expect(countRow).toContainText('FUEN');
    const input = countRow.getByRole('spinbutton').nth(1);
    await input.fill('7');
    await input.press('Tab');
    await expect(page.locator('#guard-counts-panel')).toContainText('Desat');
    await page.locator('#guard-count-slot').selectOption('1|8:55');
    await expect(countRow.getByRole('spinbutton').nth(1)).toHaveValue('0');
    await page.locator('#guard-count-slot').selectOption('1|8:00');
    await expect(input).toHaveValue('7');

    await page.getByRole('tab', { name: 'Estadístiques' }).click();
    await expect(page.locator('#guardies-statistics-panel')).toBeVisible();
    await expect(page.locator('[data-stat-total]')).toHaveText('7');
    await expect(page.locator('[data-stat-guard]')).toHaveText('7');
    await expect(page.locator('[data-stat-released]')).toHaveText('4');
    await expect(page.locator('[data-ranking-most] li').first()).toContainText('Fuentes Serra');
    await expect(page.locator('[data-ranking-most] li').first()).toContainText('7 G');
    await expect(page.locator('[data-ranking-most] li').first()).toContainText('4 allib.');
    await expect(page.locator('[data-slot-most] li').first()).toContainText('Dilluns · 1a · 8:00');
    await expect(page.locator('[data-slot-most] li').first()).toContainText('7');
    await expect(page.locator('[data-ranking-least] li')).toHaveCount(4);
    await expect(page.locator('[data-slot-least] li')).toHaveCount(3);

    await page.goto('/?vista=professor');
    await expect(page.getByRole('tab', { name: 'Estadístiques' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.getByRole('heading', { name: 'Recompte de guàrdies per hores' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Dilluns' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Divendres' })).toBeVisible();
    const publicTeacher = page.locator('[data-roster-slot="1|8:00"] [data-roster-teacher="2"]');
    await expect(publicTeacher.locator('span')).toHaveText('Fuentes Serra, Gabriel');
    await expect(publicTeacher).not.toContainText('FUEN');
    await expect(publicTeacher.locator('[data-roster-count]')).toHaveText('7');
    await expect(page.locator('[data-roster-slot="1|8:55"] [data-roster-teacher="3"] [data-roster-count]')).toHaveText('0');
    await expect(page.locator('.teacher-stats-table')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('configura observacions preestablertes i permet text lliure', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#observation-presets-panel summary').click();
    const newPhrase = page.getByLabel('Nova observació preestablerta');
    await newPhrase.fill('Feina a Classroom');
    await newPhrase.press('Enter');
    await expect(page.locator('#observation-presets-panel')).toContainText('Feina a Classroom');
    await newPhrase.fill('Material al calaix');
    await newPhrase.press('Enter');
    await expect(page.locator('#observation-presets-panel')).toContainText('Material al calaix');

    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid [data-absence]:not(:disabled)').first().check();
    const row = page.locator('#coverage-list .coverage-row').filter({ has: page.locator('[data-comment]') }).first();
    await row.locator('[data-comment-preset]').selectOption({ label: 'Feina a Classroom' });
    await expect(row.locator('[data-comment]')).toHaveValue('Feina a Classroom');
    await row.locator('[data-comment-preset]').selectOption({ label: 'Material al calaix' });
    await expect(row.locator('[data-comment]')).toHaveValue('Feina a Classroom · Material al calaix');
    await row.locator('[data-comment-preset]').selectOption({ label: 'Feina a Classroom' });
    await expect(row.locator('[data-comment]')).toHaveValue('Feina a Classroom · Material al calaix');
    await row.locator('[data-comment]').fill('Feina a Classroom · Material al calaix · Indicació excepcional');
    await expect(row.locator('[data-comment-preset]')).toHaveValue('');

    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('[data-comment]')).toHaveValue('Feina a Classroom · Material al calaix · Indicació excepcional');
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#observation-presets-panel summary').click();
    await expect(page.locator('#observation-presets-panel')).toContainText('Feina a Classroom');
  });

  test('deixa el company de la mateixa aula sense comptar-li cap guàrdia', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles(sharedDutiesFile);
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();

    const flexible = page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:00' });
    await flexible.locator('[data-absence]').check();
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveCount(1);
    await flexible.locator('[data-absence]').uncheck();

    const shared = page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:55' });
    await shared.locator('[data-absence]').check();
    const coverage = page.locator('#coverage-list .coverage-item').first();
    await expect(coverage).toContainText('Fuentes Serra, Gabriel');
    await expect(coverage.locator('.co-teacher-badge')).toHaveText('Queda amb el grup');
    const sharedAssignment = coverage.locator('[data-assignacio]');
    await expect(sharedAssignment).toHaveCount(1);
    await expect(sharedAssignment).toHaveValue('2');

    await page.waitForTimeout(500);
    const assignment = await page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'];
      return Object.values(day.assignments)[0];
    });
    expect(assignment).toEqual({ teacherId: '2', source: 'co-teacher' });

    await sharedAssignment.selectOption('3');
    await expect(sharedAssignment).toHaveValue('3');
    await page.waitForTimeout(500);
    const reassignment = await page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'];
      return Object.values(day.assignments)[0];
    });
    expect(reassignment).toEqual({ teacherId: '3', source: 'guard' });

    await sharedAssignment.selectOption('');
    await expect(sharedAssignment).toHaveValue('');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveValue('');

    await page.locator('#professor-search').fill('FUEN');
    await expect(page.locator('#professor-results [data-professor]').first()).toHaveClass(/suggested/);
    await page.locator('#professor-search').press('Enter');
    await expect(page.locator('#schedule-title')).toContainText('Fuentes Serra, Gabriel');
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:55' }).locator('[data-absence]').check();
    await expect(page.locator('#coverage-list .coverage-item')).toHaveCount(1);
    await expect(coverage).toContainText('Adell Domènech, Marina');
    await expect(coverage).toContainText('Fuentes Serra, Gabriel');
    await expect(coverage.locator('.coverage-group-label')).toHaveText('1ESO-A');
    await expect(coverage.locator('.co-teacher-badge')).toHaveCount(0);
    await expect(coverage.locator('[data-assignacio]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Publica' }).click();
    await page.getByRole('button', { name: 'Tanca jornada' }).click();
    const count = await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).stats?.counts?.['2']
    ));
    expect(count).toBeUndefined();
  });

  test('exclou el professorat d\'Agrària de tot el mòdul de guàrdies', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#teacher-exclusions-panel summary').click();
    await page.locator('#teacher-exclusions-search').fill('Adell');
    const row = page.locator('.teacher-exclusions-row').filter({ hasText: 'Adell Domènech' });
    await expect(row).toContainText('marina.adell@iesjosepsuredaiblanes.com');
    const checkbox = row.getByRole('checkbox');
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeEnabled();

    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#professor-search').fill('Adell');
    await expect(page.locator('#professor-results')).toHaveText('Sense resultats');

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#guard-counts-panel summary').click();
    await page.locator('#guard-count-search').fill('Adell');
    await expect(page.locator('.guard-count-row').filter({ hasText: 'Adell Domènech' })).toHaveCount(0);

    await page.reload();
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#teacher-exclusions-panel summary').click();
    await page.locator('#teacher-exclusions-search').fill('Adell');
    await expect(page.getByRole('checkbox', { name: 'Adell Domènech, Marina és d’FP' })).toBeChecked();
  });

  test('sincronitza la jornada entre dues sessions sense recarregar', async ({ page, context }) => {
    await openGuardies(page);
    const otherPage = await context.newPage();
    await openGuardies(otherPage);
    await expect(otherPage.locator('#cache-info')).toContainText('0/3 fitxers compartits');

    await uploadConfiguration(page);
    await expect(otherPage.locator('#cache-info')).toContainText('3/3 fitxers compartits');
    await expect(otherPage.locator('#workspace')).toBeVisible();

    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await otherPage.locator('#date-input').fill('2026-09-07');
    await otherPage.locator('#date-input').press('Tab');
    await expect(otherPage.locator('#coverage-list [data-assignacio]')).toHaveCount(0);

    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();

    await expect(otherPage.locator('#coverage-list [data-assignacio]')).toHaveCount(2);
    await otherPage.close();
  });

  test('aplica totes les hores de cada dia en un interval i en mostra el resultat', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();

    await page.locator('.range-builder input[type="date"]').nth(1).fill('2026-09-08');
    await page.getByRole('button', { name: 'Aplica interval' }).click();
    await expect(page.locator('.range-builder .range-feedback')).toHaveText('Totes les hores aplicades a 2 dies lectius · 4 sessions.');

    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveCount(1);
    await expect(page.locator('#coverage-list')).toContainText('Adell Domènech');
  });

  test('assigna automàticament primer alliberats i després professorat de G', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats = { counts: {
        2: { total: 5, released: 0, guard: 5, other: 0, guardSlots: { '1|8:00': 5 } },
        3: { total: 0, released: 0, guard: 0, other: 0, guardSlots: {} },
      } };
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');

    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await page.getByRole('tab', { name: 'Professor/a', exact: true }).click();
    await page.locator('#professor-search').fill('MAT1');
    await expect(page.locator('#professor-results [data-professor]').first()).toContainText('Professor Matemàtiques');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();

    await page.locator('#auto-assign-guards').click();
    await expect(page.locator('.auto-assignment-feedback')).toHaveText('2 assignades');
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveCount(2);
    await expect(page.locator('#coverage-list [data-assignacio]').first()).toHaveValue('1');
    await expect(page.locator('#coverage-list [data-assignacio]').nth(1)).toHaveValue('1');

    await page.waitForTimeout(500);
    const sources = await page.evaluate(() => Object.values(
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].assignments,
    ).map((assignment) => assignment.source).sort());
    expect(sources).toEqual(['guard', 'released']);

    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid [data-absence]:not(:disabled)').first().check();
    // Override the classroom partner before requesting a normal G assignment.
    await page.locator('#coverage-list [data-assignacio]').first().selectOption('');
    await page.locator('#auto-assign-guards').click();
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveValue('3');
  });

  test('selecciona un professor absent, crea cobertures i conserva la jornada', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);

    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();

    await expect(page.locator('#schedule-grid [data-absence]:not(:disabled)')).toHaveCount(3);
    await page.locator('#add-all-hours').click();
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveCount(2);
    await expect(page.locator('#print-coverage')).toBeEnabled();
    const guardDutyRow = page.locator('#coverage-list .coverage-row').filter({ has: page.locator('.coverage-detail-cell', { hasText: 'Guàrdia' }) }).first();
    await expect(guardDutyRow.locator('.info-only-label')).toHaveText('Sense substitució');
    await expect(guardDutyRow.locator('[data-assignacio]')).toHaveCount(0);
    await expect(page.locator('.coverage-professor-cell .cell-kicker').first()).toHaveText('Absència');

    const firstAssignment = page.locator('#coverage-list [data-assignacio]').first();
    const candidateLabels = await page.locator('#coverage-list [data-assignacio]').nth(1).locator('option').allTextContents();
    const guardIndex = candidateLabels.findIndex((label) => label.includes('Guàrdia -'));
    const outsideDutyIndexes = candidateLabels
      .map((label, index) => label.includes('Ni G ni alliberat') ? index : -1)
      .filter((index) => index >= 0);
    expect(guardIndex).toBeGreaterThan(0);
    expect(outsideDutyIndexes.length).toBeGreaterThan(0);
    expect(Math.min(...outsideDutyIndexes)).toBeGreaterThan(guardIndex);
    await firstAssignment.selectOption('2');
    await expect(firstAssignment).toHaveValue('2');

    await page.waitForTimeout(500);
    await page.reload();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('#coverage-list [data-assignacio]')).toHaveCount(2);
    await expect(page.locator('.print-session-detail').first()).toBeHidden();
    await expect(page.locator('.coverage-group-label').first()).toHaveCSS('font-weight', '900');
    await expect(page.locator('.coverage-room-label').first()).toHaveCSS('font-weight', '900');
    const sessionHeaderStyle = await page.locator('.coverage-session:not(.pati-session) .coverage-session-head').first().evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        minHeight: Number.parseFloat(style.minHeight),
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
      };
    });
    expect(sessionHeaderStyle.minHeight).toBeGreaterThanOrEqual(40);
    expect(sessionHeaderStyle.backgroundImage).not.toBe('none');
    expect(sessionHeaderStyle.boxShadow).not.toBe('none');
    await page.setViewportSize({ width: 1080, height: 800 });
    await expect(page.locator('.day-command-bar button')).toHaveCount(3);
    expect(await page.locator('.work-header').evaluate((header) => header.scrollWidth <= header.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    const publicProjection = await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).publicDays?.['2026-09-07']
    ));
    expect(publicProjection.status).toBe('published');
    expect(publicProjection.hours.some((hour) => hour.rows?.length)).toBe(true);
    await page.getByRole('button', { name: 'Despublica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Publica');
    expect(await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).publicDays?.['2026-09-07']
    ))).toBeUndefined();
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Tanca jornada' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Reobre');
    const guardCount = await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).stats.counts['2']
    ));
    expect(guardCount).toEqual({
      total: 1, released: 0, guard: 1, other: 0, guardLegacy: 0, guardSlots: { '1|8:00': 1 },
    });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('/?vista=professor');
    await expect(page.locator('.teacher-date-header')).toBeVisible();
    await expect(page.locator('.teacher-date-header #date-input')).toBeVisible();
    await expect(page.locator('.teacher-date-header .work-title, .teacher-date-header .date-summary-card, .teacher-date-header .day-command-bar')).toHaveCount(0);
    await expect(page.locator('.teacher-stats-panel')).toBeHidden();
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('.teacher-stats-panel')).toBeVisible();
    await expect(page.locator('.teacher-date-header')).toBeHidden();
    for (const selector of ['#admin-panel', '#pati-panel', '#convivencia-panel']) {
      await expect(page.locator(selector)).toBeHidden();
    }
    await expect(page.locator('[data-roster-slot="1|8:00"] [data-roster-teacher="2"] [data-roster-count]')).toHaveText('1');
    await page.getByRole('tab', { name: 'Guàrdies del dia' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    const publicAbsentTeacher = page.locator('.coverage-professor-cell strong.no-print').first();
    await expect(publicAbsentTeacher).toHaveText('Adell Domènech, Marina');
    await expect(publicAbsentTeacher).not.toContainText('ADEL');
    await expect(page.locator('.readonly-assignment').filter({ hasText: 'Fuentes Serra' })).toHaveCount(1);
    await expect(page.locator('.readonly-assignment').filter({ hasText: 'Fuentes Serra' })).not.toContainText('·');
    await expect(page.locator('[data-assignacio], [data-remove-absence]')).toHaveCount(0);
    const readonlyRow = page.locator('.coverage-item.coverage-row').filter({ has: page.locator('.readonly-assignment') }).first();
    const cellTops = await readonlyRow.locator(':scope > .coverage-professor-cell, :scope > .coverage-detail-cell, :scope > .coverage-assignment-cell, :scope > .coverage-comment-cell')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(cellTops).size).toBe(1);

    await page.getByRole('link', { name: 'Guàrdies', exact: true }).click();
    await page.getByRole('button', { name: 'Reobre' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    const reopenedCount = await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).stats.counts['2']
    ));
    expect(reopenedCount).toEqual({ total: 0, released: 0, guard: 0, other: 0, guardLegacy: 0, guardSlots: {} });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('guardies:day-action', { detail: { action: 'unpublish' } })));
    await expect(page.locator('#day-status-action')).toHaveText('Publica');
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Jornada encara no publicada' })).toBeVisible();
  });

  test('guarda una assignació setmanal de convivència', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#convivencia-panel summary').click();
    const firstSlot = page.locator('[data-convivencia-slot="1|8:00"]');
    await expect(firstSlot).toBeVisible();
    await firstSlot.selectOption({ index: 1 });
    const selected = await firstSlot.inputValue();
    expect(selected).not.toBe('');

    await expect(page.locator('#cache-info')).toContainText('3/3 fitxers compartits');
    await page.reload();
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#convivencia-panel summary').click();
    await expect(page.locator('[data-convivencia-slot="1|8:00"]')).toHaveValue(selected);
  });

  test('configura manualment zones i GP, desa automàticament i salta festius', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await expect(page.locator('.pati-roster-row')).toHaveCount(0);
    await page.locator('#new-pati-zone').fill('Pista');
    await page.locator('#add-pati-zone').click();
    await page.locator('#new-pati-zone').fill('Porxada');
    await page.locator('#add-pati-zone').click();

    await page.locator('#pati-teacher-search').fill('Fuentes');
    await page.locator('.pati-teacher-results [role="option"]').first().click();
    await page.locator('#pati-teacher-search').fill('Sanz');
    await page.locator('#pati-teacher-search').press('Enter');
    await expect(page.locator('.pati-roster-row')).toHaveCount(2);
    await expect(page.locator('.pati-roster-row').first()).toContainText('Fuentes Serra');
    const zoneRows = page.locator('.pati-zone-row');
    await zoneRows.nth(1).getByRole('button', { name: 'Arrossega Porxada' }).dragTo(zoneRows.nth(0));
    await expect(page.getByLabel('Nom de la zona 1')).toHaveValue('Porxada');
    await expect(page.getByLabel('Nom de la zona 2')).toHaveValue('Pista');

    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    const patioCards = page.locator('#coverage-list .pati-zone-card');
    await expect(patioCards).toHaveCount(2);
    const cardSizes = await patioCards.evaluateAll((cards) => cards.map((card) => ({
      width: card.getBoundingClientRect().width,
      height: card.getBoundingClientRect().height,
    })));
    expect(cardSizes[0].width).toBeCloseTo(cardSizes[1].width, 0);
    expect(cardSizes[0].height).toBe(cardSizes[1].height);
    const typeSizes = await patioCards.first().evaluate((card) => ({
      zone: Number.parseFloat(getComputedStyle(card.querySelector('.pati-zone-select')).fontSize),
      teacher: Number.parseFloat(getComputedStyle(card.querySelector('.pati-teacher-name')).fontSize),
    }));
    expect(typeSizes.zone).toBeGreaterThan(typeSizes.teacher);

    const fuentesCard = patioCards.filter({ hasText: 'Fuentes Serra' });
    await fuentesCard.locator('[data-pati-zone-override]').selectOption({ label: 'Porxada' });
    await expect(fuentesCard).toHaveClass(/overridden/);
    await expect(fuentesCard.locator('[data-pati-zone-override]')).toHaveValue('zona-2');
    await page.locator('[data-comment="__pati_observation__"]')
      .fill('Banys ha de quedar cobert durant tot el pati.');
    await expect(page.locator('[data-comment-print="__pati_observation__"]'))
      .toContainText('Banys ha de quedar cobert');

    await page.locator('#professor-search').fill('Fuentes');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: 'PATI' }).locator('[data-absence]').check();
    await expect(page.locator('.pati-zone-card.absent')).toHaveCount(1);
    await expect(page.locator('.pati-zone-card.absent .pati-absence-badge')).toHaveText('Absent');
    await expect(page.locator('.coverage-session.pati-session .coverage-session-list')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await page.locator('#pati-holiday-date').fill('2026-09-21');
    await page.locator('#pati-holiday-label').fill('Festa del centre');
    await page.locator('#add-pati-holiday').click();
    await expect(page.getByText('Desat automàticament')).toBeVisible();
    await expect(page.locator('#save-pati-config')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await expect(page.locator('#coverage-list .pati-info-strip')).toContainText('Pista');

    await page.reload();
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('.pati-zone-card').filter({ hasText: 'Fuentes Serra' })
      .locator('[data-pati-zone-override]')).toHaveValue('zona-2');
    await expect(page.locator('[data-comment="__pati_observation__"]'))
      .toHaveValue('Banys ha de quedar cobert durant tot el pati.');
    await page.locator('#date-input').fill('2026-09-21');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('#coverage-list .pati-info-strip')).toContainText('Festa del centre');

    await page.locator('#date-input').fill('2026-09-28');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('#coverage-list .pati-info-strip')).toContainText('Porxada');
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await expect(page.getByLabel('Nom de la zona 1')).toHaveValue('Porxada');
    await expect(page.getByLabel('Nom de la zona 2')).toHaveValue('Pista');
    await expect(page.getByText('Festa del centre')).toBeVisible();
  });

  test('una sortida completa allibera professorat i els acompanyants generen absències', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await expect(page.locator('#group-search')).toHaveValue('');
    const releasedCandidates = page.locator('[data-group-released="10"]:not(:disabled)');
    await expect(releasedCandidates).toHaveCount(2);
    await expect(releasedCandidates.first()).toBeChecked();
    await expect(releasedCandidates.nth(1)).toBeChecked();
    await expect(page.locator('[data-group-released="10"]:disabled')).toHaveCount(1);
    await expect(page.locator('[data-group-released="10"]:disabled')).not.toBeChecked();
    await expect(page.locator('#released-count')).toContainText('1 professor');
    await expect(page.getByText('Candidat', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-confirm-group-released="10"]')).toHaveCount(0);
    await releasedCandidates.first().uncheck();
    await releasedCandidates.nth(1).uncheck();
    await expect(page.locator('#released-count')).toContainText('0 professors');
    await releasedCandidates.first().check();
    await releasedCandidates.nth(1).check();
    await expect(page.locator('#released-count')).toContainText('1 professor');

    await page.locator('[data-add-group-companion="10"]').selectOption('1');
    await expect(page.locator('[data-group-companion="10"][data-teacher="1"]')).toBeVisible();
    await expect(page.locator('#released-count')).toContainText('0 professors');
    await expect(page.locator('#coverage-list .coverage-item.coverage-row:not(.not-completed)')).toHaveCount(3);

    await page.waitForTimeout(500);
    await page.reload();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await expect(page.locator('[data-group-companion="10"][data-teacher="1"]')).toBeVisible();

    await page.locator('[data-add-group-companion="10"]').selectOption('2');
    await expect(page.locator('[data-group-companion="10"][data-teacher="2"]')).toBeVisible();
    await expect(page.locator('#coverage-list .coverage-item.coverage-row:not(.not-completed)')).toHaveCount(4);

    await page.locator('#outing-to').fill('2026-09-08');
    await page.getByRole('button', { name: 'Copia als dies de l’interval' }).click();
    await expect(page.getByText('Sortida copiada a 1 dia lectiu.')).toBeVisible();
    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await page.getByRole('button', { name: 'Publica' }).click();
    const publishedGroups = await page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-08'].groupsOut
    ));
    expect(publishedGroups).toContain('10');
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Grups de sortida' })).toBeVisible();
    await expect(page.locator('[data-public-outing-group="10"]')).toContainText('Fora del centre');
  });

  test('decideix per cada grup si la sortida és completa o parcial', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();

    await page.locator('#group-search').selectOption('10');
    await page.locator('#group-search').selectOption('11');
    const groupA = page.locator('[data-group-complete="10"]');
    const groupB = page.locator('[data-group-complete="11"]');
    await expect(groupA).toBeChecked();
    await expect(groupB).toBeChecked();

    await groupA.uncheck();
    await expect(groupA).not.toBeChecked();
    await expect(groupB).toBeChecked();

    await page.locator('#outing-to').fill('2026-09-08');
    await page.getByRole('button', { name: 'Copia als dies de l’interval' }).click();
    await expect(page.getByText('Sortida copiada a 1 dia lectiu.')).toBeVisible();
    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('[data-group-complete="10"]')).not.toBeChecked();
    await expect(page.locator('[data-group-complete="11"]')).toBeChecked();
  });

  test('mostra el pati entre tercera i quarta i permet copiar sortides', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await expect(page.locator('#coverage-list .coverage-session').nth(3)).toContainText('Pati · 10:45–11:15');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await expect(page.getByRole('button', { name: 'Copia als dies de l’interval' })).toBeDisabled();
  });

  test('la versió impresa A3 conserva les franges en una sola pàgina i amaga els controls', async ({ page }, testInfo) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    for (const professor of ['FUENTES', 'SANZ', 'MAT1']) {
      await page.locator('#professor-search').fill(professor);
      await page.locator('#professor-results [data-professor]').first().click();
      await page.locator('#add-all-hours').click();
    }
    if (testInfo.project.name === 'chromium-desktop') {
      await page.evaluate(() => {
        const target = document.querySelector('#coverage-list .coverage-table');
        const source = target?.querySelector('.coverage-item');
        if (!target || !source) return;
        for (let index = 0; index < 28; index += 1) target.append(source.cloneNode(true));
        window.dispatchEvent(new Event('beforeprint'));
      });
      await expect(page.locator('html')).toHaveAttribute('data-guardies-print-density', 'compact');
    }
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-header')).toBeVisible();
    await expect(page.locator('.print-header > img')).toBeVisible();
    await expect(page.locator('.print-header')).not.toContainText('ESBORRANY');
    const printHeaderRows = await page.locator('.print-header').evaluate((header) => {
      const elements = [header.querySelector('img'), header.querySelector('.print-title-copy'), header.querySelector('#print-date-label')];
      const boxes = elements.map((element) => element.getBoundingClientRect());
      const copy = header.querySelector('.print-title-copy');
      return {
        centers: boxes.map((box) => Math.round(box.top + box.height / 2)),
        copyDisplay: getComputedStyle(copy).display,
        copyFits: copy.scrollWidth <= copy.clientWidth,
        titleVisible: copy.querySelector('h1').getClientRects().length > 0,
      };
    });
    expect(Math.max(...printHeaderRows.centers) - Math.min(...printHeaderRows.centers)).toBeLessThanOrEqual(2);
    expect(printHeaderRows).toMatchObject({ copyDisplay: 'flex', titleVisible: true });
    if (testInfo.project.name === 'chromium-desktop') expect(printHeaderRows.copyFits).toBe(true);
    await expect(page.locator('.entry-panel')).toBeHidden();
    expect(await page.locator('.coverage-session').count()).toBeGreaterThan(0);
    const printedSession = page.locator('.print-session-detail').first();
    await expect(printedSession).toBeVisible();
    await expect(printedSession).toContainText('1ESO-A · MAT · Aula 14');
    const printedDetailFontSize = await printedSession.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    expect(printedDetailFontSize).toBeGreaterThanOrEqual(testInfo.project.name === 'chromium-desktop' ? 9.5 : 11);
    await expect(printedSession.locator('.print-detail-highlight')).toHaveCount(2);
    await expect(printedSession.locator('.print-detail-highlight').first()).toHaveText('1ESO-A');
    await expect(printedSession.locator('.print-detail-highlight').last()).toHaveText('Aula 14');
    const printedAbsentTeacher = page.locator('.coverage-professor-cell .print-only').first();
    await expect(printedAbsentTeacher).toHaveText('Adell Domènech, Marina');
    await expect(printedAbsentTeacher).not.toContainText('ADEL');
    await expect(page.locator('.coverage-detail-cell > strong.no-print').first()).toBeHidden();
    const printedHourHeader = page.locator('.coverage-session:not(.pati-session) .coverage-session-head').first();
    await expect(printedHourHeader).toHaveCSS('background-color', 'rgb(230, 230, 230)');
    await expect(printedHourHeader.locator('span')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const nonGrayPrintColors = await page.locator('.day-panel').evaluate((panel) => {
      const properties = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];
      const failures = [];
      for (const node of [panel, ...panel.querySelectorAll('*')]) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || node.getClientRects().length === 0) continue;
        for (const property of properties) {
          const value = style[property];
          const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
          if (!match || Number(match[4] || 1) === 0) continue;
          const [, red, green, blue] = match.map(Number);
          if (red !== green || green !== blue) failures.push(`${node.className || node.tagName}:${property}:${value}`);
        }
      }
      return failures;
    });
    expect(nonGrayPrintColors).toEqual([]);
    if (testInfo.project.name === 'chromium-desktop') {
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      const raw = pdf.toString('latin1');
      const pages = raw.match(/\/Type\s*\/Page(?!s)\b/g) || [];
      const mediaBox = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
      expect(pages).toHaveLength(1);
      expect(Number(mediaBox?.[1])).toBeGreaterThan(840);
      expect(Number(mediaBox?.[2])).toBeGreaterThan(1190);
    }
  });

  test('la versió impresa reparteix el buit entre les sessions i omple l A3', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop');
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles(sevenSessionsDutiesFile);
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });

    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.day-panel').getBoundingClientRect();
      const list = document.querySelector('#coverage-list').getBoundingClientRect();
      const sessions = Array.from(document.querySelectorAll('.coverage-session:not(.pati-session):not(.seventh-session)'))
        .map((node) => node.getBoundingClientRect());
      const patio = document.querySelector('.coverage-session.pati-session').getBoundingClientRect();
      const seventh = document.querySelector('.coverage-session.seventh-session').getBoundingClientRect();
      return {
        panelHeight: panel.height,
        sessionHeights: sessions.map((box) => box.height),
        patioHeight: patio.height,
        seventhHeight: seventh.height,
        bottomGap: Math.abs(panel.bottom - list.bottom),
      };
    });

    expect(layout.panelHeight).toBeGreaterThan(1500);
    expect(Math.max(...layout.sessionHeights) - Math.min(...layout.sessionHeights)).toBeLessThan(2);
    expect(layout.patioHeight).toBeLessThan(Math.min(...layout.sessionHeights));
    expect(layout.seventhHeight).toBeLessThan(Math.min(...layout.sessionHeights));
    expect(layout.seventhHeight).toBeGreaterThan(25);
    expect(layout.bottomGap).toBeLessThan(2);
  });
});
