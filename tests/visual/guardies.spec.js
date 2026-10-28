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
  test('dibuixar la cobertura no modifica assignacions ni programa guardats', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().dayRevision;
    })).toBeGreaterThan(0);
    const before = await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const store = useGuardiesStore();
      const id = Array.from(store.absencies.keys())[0];
      // An uncommitted edit makes both hidden mutation and autosave observable.
      store.assignacions.set(id, 'invalid-candidate');
      store.assignmentSources.set(id, 'other');
      store.comentaris.set(id, 'Encara no confirmat');
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
        window.dispatchEvent(new CustomEvent('guardies:pati-updated'));
      }
      return { id, revision: store.dayRevision };
    });
    await page.waitForTimeout(400); // Cross the existing 250 ms debounce.
    expect(await page.evaluate(async ({ id }) => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const store = useGuardiesStore();
      const saved = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'];
      return { assignment: store.assignacions.get(id), comment: store.comentaris.get(id), revision: saved.revision };
    }, before)).toEqual({ assignment: 'invalid-candidate', comment: 'Encara no confirmat', revision: before.revision });
  });

  test('netejar el dia continua guardant encara que dibuixar no guardi', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.absenceIds.length)).toBe(3);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Neteja dia', exact: true }).click();
    await expect(page.locator('[data-remove-absence]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].absenceIds)).toEqual([]);
    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('[data-remove-absence]')).toHaveCount(0);
  });

  test('els recomptes remots no interrompen una observació ni dupliquen guardats', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const editor = page.locator('[data-comment]').first();
    await editor.fill('Observació amb espais  ');
    await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.comments || {}))).toContain('Observació amb espais');
    const revision = await editor.evaluate((input) => {
      window.editorBeforeUpdate = input;
      input.focus();
      input.setSelectionRange(5, 10);
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats ||= { counts: {} };
      data.stats.counts['2'] = { guard: 8 };
      localStorage.setItem(key, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent('storage', { key }));
      return data.days['2026-09-07'].revision;
    });
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().guardCounts.get('2')?.guard;
    })).toBe(8);
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) window.dispatchEvent(new CustomEvent('guardies:pati-updated'));
    });
    expect(await editor.evaluate((input) => ({ same: input === window.editorBeforeUpdate, active: input === document.activeElement,
      value: input.value, selection: [input.selectionStart, input.selectionEnd] }))).toEqual({ same: true, active: true,
      value: 'Observació amb espais  ', selection: [5, 10] });
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].revision)).toBe(revision);
  });

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
      await saveGuardiesDay('e2e-2026', '2026-09-07', { status: 'draft', comments: { pati_observation: 'Servidor' } }, 0);
    });
    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      window.dispatchEvent(new CustomEvent('guardies:legacy-render', { detail: { reloadDay: true } }));
      const state = useGuardiesStore();
      state.comentaris.set('pati_observation', 'Edició durant la càrrega');
    });
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().comentaris.get('pati_observation');
    })).toBe('Edició durant la càrrega');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.comments?.pati_observation)).toBe('Edició durant la càrrega');
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

  test("el professorat només escolta el recompte mentre en veu la pestanya i no reprocessa l'horari en tornar", async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.goto('/?data=2026-09-07&vista=professor');
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('[data-roster-teacher="2"]').first()).toBeVisible();
    const setCount = (value) => page.evaluate((guard) => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats = { ...(data.stats || {}), counts: { 2: { guard } } };
      localStorage.setItem(key, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, value);
    const storeState = () => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const store = useGuardiesStore();
      return { guard: store.guardCounts.get('2')?.guard || 0, sameSessions: store.sessions === window.sessionsBeforeLeaving };
    });

    await setCount(4);
    await expect.poll(async () => (await storeState()).guard).toBe(4);
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      window.sessionsBeforeLeaving = useGuardiesStore().sessions;
    });

    await page.getByRole('tab', { name: 'Guàrdies del dia' }).click();
    await expect(page.locator('.teacher-stats-panel')).toHaveCount(0);
    await setCount(9);
    await page.waitForTimeout(200);
    expect((await storeState()).guard).toBe(4);

    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect.poll(async () => (await storeState()).guard).toBe(9);
    expect((await storeState()).sameSessions).toBe(true);
    await expect(page.locator('.teacher-stats-panel [role="status"]')).toHaveCount(0);
  });

  test('una reconnexió amb la pestanya oculta espera a tornar-hi per recarregar', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    const status = () => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().persistenceStatus;
    });
    await expect.poll(status).toBe('ready');
    await page.evaluate(async () => {
      window.__hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      useGuardiesStore().persistenceStatus = 'error';
      window.__hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(300);
    expect(await status()).toBe('error');
    await page.evaluate(() => {
      window.__hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(status).toBe('ready');
  });

  test('canvia entre Guàrdies i Professorat sense recarregar i reutilitza l\'horari processat', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      window.__samePage = true;
      window.__parsedBefore = useGuardiesStore().allSessions;
    });
    const professorat = page.getByRole('link', { name: 'Professorat', exact: true });
    const guardies = page.getByRole('link', { name: 'Guàrdies', exact: true });

    await professorat.click();
    await expect(professorat).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/vista=professor/);
    await expect(page.getByRole('tab', { name: 'Guàrdies del dia' })).toBeVisible();
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('[data-roster-teacher]').first()).toBeVisible();

    await guardies.click();
    await expect(guardies).toHaveAttribute('aria-current', 'page');
    await expect(page).not.toHaveURL(/vista=professor/);
    await expect(page.locator('#workspace')).toBeVisible();
    const state = await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return { samePage: window.__samePage === true, sameParse: useGuardiesStore().allSessions === window.__parsedBefore };
    });
    expect(state).toEqual({ samePage: true, sameParse: true });

    // Enrere del navegador: torna a Professorat, també sense recarregar.
    await page.goBack();
    await expect(page).toHaveURL(/vista=professor/);
    await expect(page.getByRole('tab', { name: 'Guàrdies del dia' })).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    expect(await page.evaluate(() => window.__samePage === true)).toBe(true);
  });

  test('tornar de Professorat a Guàrdies no desa la jornada ni en perd les absències', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const stored = () => page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'];
      return day ? { revision: day.revision, status: day.status, absences: day.absenceIds.length } : null;
    });
    await expect.poll(async () => (await stored())?.absences || 0).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.waitForTimeout(400);
    const before = await stored();
    expect(before.status).toBe('published');

    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Guàrdies del dia' })).toBeVisible();
    await page.getByRole('link', { name: 'Guàrdies', exact: true }).click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.waitForTimeout(700);

    expect(await stored()).toEqual(before);
    await expect(page.locator('[data-remove-absence]')).toHaveCount(before.absences);
    await expect(page.locator('#error-box')).toBeHidden();
  });

  test('una còpia local amb un estat no vàlid es descarta i no bloqueja la jornada ni el canvi de data', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const stored = () => page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'];
      return day ? { revision: day.revision, status: day.status, absences: day.absenceIds.length } : null;
    });
    await expect.poll(async () => (await stored())?.absences || 0).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    const before = await stored();

    // Còpia local creada per l'error anterior: estat de la vista del professorat i sense absències.
    const draftKey = 'guardies_pending_day:e2e-2026:e2e.admin@iesjosepsuredaiblanes.com:2026-09-07';
    await page.evaluate(({ key, revision }) => {
      localStorage.setItem(key, JSON.stringify({
        payload: {
          status: 'unpublished', absenceIds: [], assignments: {}, comments: {}, groupsOut: [], groupTeachers: {},
          groupReleasedTeachers: {}, partialGroups: [], outingAbsenceIds: [], cancelledAssignments: [],
          overriddenCoTeacherAssignments: [], publishedAt: '', closedAt: '', countedAssignments: [],
        },
        revision,
        baseSignature: 'signatura-anterior',
        auto: false,
      }));
    }, { key: draftKey, revision: before.revision });
    await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();

    await expect(page.locator('[data-remove-absence]')).toHaveCount(before.absences);
    await expect(page.locator('#day-status-action')).toHaveText('Publica');
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();

    await page.getByRole('button', { name: 'Dia següent' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    await expect(page.locator('#error-box')).toBeHidden();
    expect(await stored()).toEqual(before);
  });

  test('un estat de jornada no vàlid en memòria no bloqueja el canvi de data ni es desa', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const stored = () => page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'];
      return day ? { revision: day.revision, status: day.status, absences: day.absenceIds.length } : null;
    });
    await expect.poll(async () => (await stored())?.absences || 0).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    const before = await stored();
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      useGuardiesStore().dayStatus = 'unpublished';
    });
    await page.getByRole('button', { name: 'Dia següent' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    await expect(page.locator('#error-box')).toBeHidden();
    expect(await stored()).toEqual(before);
  });

  test('escriure una observació no desa a cada paraula, però la desa en sortir del camp', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const day = () => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'] || null);
    await expect.poll(async () => (await day())?.revision || 0).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const before = (await day()).revision;
    const editor = page.locator('[data-comment]').first();
    await editor.click();
    // Mateixa frase i ritme que la mesura: abans eren 11 escriptures.
    for (const word of 'Feina penjada a Classroom i material al calaix de la taula'.split(' ')) {
      await editor.pressSequentially(`${word} `, { delay: 110 });
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(200);
    expect((await day()).revision - before).toBeLessThanOrEqual(1);
    await page.locator('#professor-search').click();
    await expect.poll(async () => Object.values((await day()).comments || {})).toContain('Feina penjada a Classroom i material al calaix de la taula');
    expect((await day()).revision - before).toBeLessThanOrEqual(2);
  });

  test('un bucle de guardats s\'atura sol i es pot reprendre', async ({ page }) => {
    test.setTimeout(60_000);
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const revision = () => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.revision || 0);
    await expect.poll(revision).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const before = await revision();
    // Simula dues sessions que es corregeixen: una edició nova cada ~300 ms.
    for (let i = 0; i < 45; i += 1) {
      await page.evaluate(async (n) => {
        const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
        const store = useGuardiesStore();
        const id = Array.from(store.absencies.keys())[0];
        store.comentaris.set(id, `bucle ${n}`);
        window.dispatchEvent(new CustomEvent('guardies:day-edited'));
      }, i);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(400);
    const written = (await revision()) - before;
    expect(written).toBeLessThanOrEqual(40);
    await expect(page.getByRole('button', { name: 'Reprèn el guardat' })).toBeVisible();
    await expect(page.locator('#error-box')).toContainText("S'ha aturat el guardat automàtic");

    // En pausa es pot canviar de data; en tornar-hi, els canvis locals hi són.
    await page.getByRole('button', { name: 'Dia següent' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    await page.getByRole('button', { name: 'Dia anterior' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await page.getByRole('button', { name: 'Reprèn el guardat' }).click();
    await expect(page.getByRole('button', { name: 'Reprèn el guardat' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].comments))).toContain('bucle 44');
  });

  test('en cap de setmana obre el primer dia lectiu si la URL no porta data', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-26T10:00:00'));
    await page.goto('/?vista=professor');
    await expect(page.locator('#date-input')).toHaveValue('2026-09-28');
    await expect(page).toHaveURL(/data=2026-09-28/);
    await page.goto('/');
    await expect(page.locator('#date-input')).toHaveValue('2026-09-28');
    // Una data explícita es respecta, encara que sigui dissabte.
    await page.goto('/?data=2026-09-26');
    await expect(page.locator('#date-input')).toHaveValue('2026-09-26');
    // El botó Avui continua portant al dia d'avui.
    await page.goto('/');
    await expect(page.locator('#date-input')).toHaveValue('2026-09-28');
    await page.getByRole('button', { name: 'Avui' }).click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-26');
  });

  test('«Avui» porta al dia d’avui encara que la pestanya estigui oberta des d’ahir', async ({ page }) => {
    // Rellotge que el test pot avançar: la pàgina continua oberta i passa la mitjanit.
    await page.addInitScript((target) => {
      const RealDate = Date;
      window.__clockOffset = target - RealDate.now();
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [RealDate.now() + window.__clockOffset])); }
        static now() { return RealDate.now() + window.__clockOffset; }
      };
    }, new Date('2026-09-07T23:59:00+02:00').getTime());
    await openGuardies(page);
    const today = page.getByRole('button', { name: 'Avui' });
    await expect(today).toHaveClass(/is-today/);

    await page.evaluate(() => { window.__clockOffset += 24 * 60 * 60 * 1000; });
    await today.click();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-08');
    await expect(today).toHaveClass(/is-today/);
  });

  test('un canvi de dia demanat mentre la jornada està ocupada no es perd', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    // Dues peticions seguides: la segona arriba mentre la primera encara desa i carrega.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: '2026-09-08' } }));
      window.dispatchEvent(new CustomEvent('guardies:change-date', { detail: { date: '2026-09-09' } }));
    });
    await expect(page.locator('#date-input')).toHaveValue('2026-09-09');
    await expect(page).toHaveURL(/data=2026-09-09/);
  });

  test('un error de permisos es mostra en català i amb què cal fer', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'quota-e2e-guardies:e2e-2026' && window.__denyWrites) {
          throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        }
        return original.call(this, key, value);
      };
      window.__denyWrites = true;
    });
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect(page.locator('#error-box')).toContainText('No tens permís per fer aquesta acció');
    await expect(page.locator('#error-box')).not.toContainText('Missing or insufficient');
  });

  test('eliminar una absència i assignar automàticament es poden desfer', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const stored = () => page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'];
      return day ? { absences: day.absenceIds.length, assignments: Object.keys(day.assignments || {}).length } : null;
    });
    await expect.poll(async () => (await stored())?.absences || 0).toBeGreaterThan(1);
    await page.waitForTimeout(400);
    const before = await stored();

    await page.locator('[data-remove-absence]').first().click();
    await expect(page.locator('.undo-toast')).toContainText("S'ha eliminat l'absència.");
    await expect.poll(async () => (await stored()).absences).toBe(before.absences - 1);
    await page.getByRole('button', { name: 'Desfés' }).click();
    await expect(page.locator('.undo-toast')).toHaveCount(0);
    await expect(page.locator('[data-remove-absence]')).toHaveCount(before.absences);
    await expect.poll(async () => (await stored()).absences).toBe(before.absences);

    await page.getByRole('button', { name: 'Assigna automàticament' }).click();
    await expect(page.locator('.undo-toast')).toContainText('automàticament');
    await expect.poll(async () => (await stored()).assignments).toBeGreaterThan(before.assignments);
    await page.getByRole('button', { name: 'Desfés' }).click();
    await expect.poll(async () => (await stored()).assignments).toBe(before.assignments);

    // L'avís desapareix sol i no se'n pot desfer res més.
    await page.locator('[data-remove-absence]').first().click();
    await expect(page.locator('.undo-toast')).toBeVisible();
    await page.getByRole('button', { name: "Tanca l'avís" }).click();
    await expect(page.locator('.undo-toast')).toHaveCount(0);
  });

  test('la vista del professorat cap a la pantalla i mostra qui cobreix en mòbil i tauleta', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    for (const width of [390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const cell = page.locator('.coverage-assignment-cell').first();
      await expect(cell).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = document.querySelector('.coverage-assignment-cell').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, right: box.right, width: window.innerWidth };
      });
      expect(layout.overflow).toBeLessThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.width);
      // Qui cobreix (o «Pendent») es llegeix almenys tan gran com qui falta.
      const sizes = await page.locator('.public-row').first().evaluate((row) => ({
        absent: Number.parseFloat(getComputedStyle(row.querySelector('.coverage-professor-cell strong')).fontSize),
        cover: Number.parseFloat(getComputedStyle(row.querySelector('.readonly-assignment')).fontSize),
      }));
      expect(sizes.cover).toBeGreaterThanOrEqual(sizes.absent);
    }
    await expect(page.locator('.public-row .status-label').first()).not.toBeEmpty();
  });

  test('avisa només els navegadors que no admeten capes CSS', async ({ page }) => {
    await page.goto('/?data=2026-09-07');
    await expect(page.locator('#outdated-browser')).toHaveCount(0);
    await page.addInitScript(() => { delete window.CSSLayerBlockRule; });
    await page.reload();
    await expect(page.locator('#outdated-browser')).toContainText('massa antic');
  });

  test('dos canvis de vista seguits acaben a l\'últim triat', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => { window.__samePage = true; });
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    await page.getByRole('link', { name: 'Guàrdies', exact: true }).click();
    await expect(page).not.toHaveURL(/vista=professor/);
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Guàrdies', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.waitForTimeout(300);
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('.nav-progress')).not.toHaveClass(/active/);
    expect(await page.evaluate(() => window.__samePage === true)).toBe(true);
  });

  test('el recompte permet cercar professorat i destacar les franges pròpies', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.goto('/?data=2026-09-07&vista=professor');
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('[data-roster-teacher]').first()).toBeVisible();
    // Sense coincidència amb qui consulta, no hi ha franges pròpies per destacar.
    await expect(page.getByRole('button', { name: 'Destaca les meves franges' })).toHaveCount(0);

    await page.getByLabel('Cerca professorat').fill('fuentes');
    const fuentes = page.locator('[data-roster-teacher="2"]').first();
    await expect(fuentes).not.toHaveClass(/is-dimmed/);
    await expect(page.locator('[data-roster-teacher].is-dimmed').first()).toBeVisible();
    await page.getByLabel('Cerca professorat').fill('');
    await expect(page.locator('[data-roster-teacher].is-dimmed')).toHaveCount(0);

    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      useGuardiesStore().viewerName = 'Fuentes Serra, Gabriel';
    });
    const toggle = page.getByRole('button', { name: 'Destaca les meves franges' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(fuentes).toHaveClass(/is-mine/);
    await expect(fuentes.locator('.roster-you')).toHaveText('Tu');
    const mineSlot = page.locator('.guard-matrix-cell.is-mine-slot').first();
    await expect(mineSlot).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.guard-matrix-cell.is-mine-slot')).toHaveCount(0);
  });

  test('mostra les dates G del professor en passar-hi per damunt', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.goto('/?data=2026-09-07&vista=professor');
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    const slot = await page.locator('[data-roster-teacher="2"]').first()
      .locator('xpath=ancestor::*[@data-roster-slot]').getAttribute('data-roster-slot');
    await page.evaluate((slotKey) => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.stats = {
        ...(data.stats || {}),
        guardHistoryVersion: 2,
        guardHistory: { 2: {
          '2026-09-18': { [slotKey]: ['1ESO-A'], '9|altra-franja': ['9ESO-Z'] },
          '2026-09-11': { '9|altra-franja': ['8ESO-Y'] },
          '2026-09-04': ['7ESO-X'],
        } },
      };
      localStorage.setItem(key, JSON.stringify(data));
    }, slot);
    await page.reload();
    await page.goto('/?data=2026-09-07&vista=professor');
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    const teacher = page.locator(`[data-roster-slot="${slot}"] [data-roster-teacher="2"]`);
    await teacher.hover();
    await expect(teacher.locator('.guard-history-tooltip')).toBeVisible();
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('1 guàrdia');
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('18/09/2026');
    await expect(teacher.locator('.guard-history-tooltip')).toContainText('1ESO-A');
    // Fitxa redissenyada: nom, franja i recompte, i una línia per data.
    await expect(teacher.locator('.guard-history-tooltip .tooltip-meta')).toContainText('1a hora · 1 guàrdia');
    await expect(teacher.locator('.guard-history-tooltip .tooltip-line')).toHaveCount(1);
    await expect(teacher.locator('.guard-history-tooltip .tooltip-line')).toHaveText(/18\/09\/2026\s*1ESO-A/);
    await expect(teacher.locator('.guard-history-tooltip')).not.toContainText('9ESO-Z');
    await expect(teacher).not.toHaveAttribute('title', /.+/);
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

  test('tanca totes les jornades pendents des de l\'avís i torna al dia on era', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    for (const date of ['2020-09-07', '2020-09-08']) {
      await page.locator('#date-input').fill(date);
      await page.locator('#date-input').press('Tab');
      await page.locator('#professor-search').fill('ADELL');
      await page.locator('#professor-results [data-professor]').first().click();
      await page.locator('#schedule-grid [data-absence]:not(:disabled)').first().check();
      await page.getByRole('button', { name: 'Publica' }).click();
      await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    }
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('.unclosed-days-warning')).toContainText('07/09/2020');
    await expect(page.locator('.unclosed-days-warning')).toContainText('08/09/2020');

    const dialogs = [];
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.accept(); });
    await page.getByRole('button', { name: 'Tanca-les totes' }).click();
    await expect(page.locator('.unclosed-days-warning')).toBeHidden();
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Vols tancar 2 jornades');
    const statuses = await page.evaluate(() => {
      const days = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days;
      return [days['2020-09-07'].status, days['2020-09-08'].status];
    });
    expect(statuses).toEqual(['closed', 'closed']);
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
    await expect(page.getByRole('heading', { name: 'Recompte de guàrdies', exact: true })).toBeVisible();
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

  test('una normalització automàtica no genera conflicte quan un altre administrador desa la jornada', async ({ page }) => {
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
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:55' }).locator('[data-absence]').check();
    await expect(page.locator('#coverage-list .coverage-status')).toHaveText('Queden amb el seu grup');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07']?.revision || 0)).toBeGreaterThan(0);
    await page.waitForTimeout(400);

    // Una altra sessió va desar la jornada sense l'assignació de codocència, i just
    // després en desa una altra versió: entre les dues només hi ha normalització automàtica.
    const result = await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      const store = useGuardiesStore();
      const key = 'quota-e2e-guardies:e2e-2026';
      const write = (mutate) => {
        const data = JSON.parse(localStorage.getItem(key));
        mutate(data.days['2026-09-07']);
        data.days['2026-09-07'].revision += 1;
        localStorage.setItem(key, JSON.stringify(data));
        window.dispatchEvent(new StorageEvent('storage', { key }));
        return data.days['2026-09-07'].revision;
      };
      write((day) => { day.assignments = {}; });
      const revision = write((day) => { day.comments = { ...day.comments, extra: 'Altra sessió' }; });
      return { revision, conflict: store.dayConflict };
    });
    expect(result.conflict).toBe(false);
    await expect(page.locator('.day-conflict')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return useGuardiesStore().dayRevision;
    })).toBeGreaterThanOrEqual(result.revision);
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
    // L'estat es diu una sola vegada, sota qui falta: sense repetir-lo sota el desplegable.
    await expect(coverage.locator('.coverage-status')).toHaveText('Queden amb el seu grup');
    await expect(coverage.locator('.co-teacher-badge')).toHaveCount(0);
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

  test('llegeix fitxers d\'Untis en ANSI sense perdre accents i avisa si un fitxer desat ja els havia perdut', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#untis-file').setInputFiles({
      name: 'GPU004.TXT',
      mimeType: 'text/plain',
      buffer: Buffer.from(teachersText.replace('Adell Domènech, Marina', 'Adell Domènech, Marina Ñúñez'), 'latin1'),
    });
    await expect(page.locator('[data-upload-status="untis"]')).toHaveText('OK');
    const stored = await page.evaluate(() => localStorage.getItem('quota-e2e-guardies:e2e-2026'));
    expect(stored).toContain('Adell Domènech, Marina Ñúñez');
    expect(stored).not.toContain('�');
    await expect(page.locator('#error-box')).toBeHidden();

    await page.locator('#duties-file').setInputFiles({
      name: 'GPU001.TXT',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${dutiesText}\n40,"1ESO-A","ADEL","MAT","L.QU�",2,1,,`),
    });
    await expect(page.locator('#error-box')).toContainText('GPU001: alguns caràcters');
  });

  test('l\'alumnat d\'un desdoblament flexible torna al seu grup sense demanar guàrdia', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles({
      name: 'GPU001.TXT',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${dutiesText}
30,"1ESO-A","MAT1","MAT-AB","AUL15",1,5,,
30,"1ESO-B","MAT1","MAT-AB","AUL15",1,5,,
31,"1ESO-A","ADEL","MAT-A","AUL14",1,5,,
32,"1ESO-B","FUEN","MAT-B","AUL16",1,5,,`),
    });
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('MAT1');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '12:10' }).locator('[data-absence]').check();

    const row = page.locator('#coverage-list .coverage-row.status-returns');
    await expect(row.locator('.coverage-status')).toHaveText('Torna al seu grup');
    await expect(row.locator('[data-assignacio] option').first()).toHaveText('Sense substitució · torna al seu grup');
    await page.locator('#auto-assign-guards').click();
    await expect(row.locator('[data-assignacio]')).toHaveValue('');

    // Si falta també qui fa la classe de 1ESO-A, aquell alumnat no té on tornar.
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '12:10' }).locator('[data-absence]').check();
    await expect(page.locator('#coverage-list .coverage-row.status-returns')).toHaveCount(0);
  });

  test('l activitat PALIC es pot marcar com una guàrdia i entra a tot el dia', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles({
      name: 'GPU001.TXT',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${dutiesText}
41,,"SANZ","PALIC","AUL14",1,5,,`),
    });
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('SANZ');
    await page.locator('#professor-results [data-professor]').first().click();

    const palic = page.locator('#schedule-grid .schedule-item').filter({ hasText: '12:10' });
    await expect(palic).toContainText('PALIC');
    await expect(palic.locator('[data-absence]')).toBeEnabled();
    await page.locator('#add-all-hours').click();
    await expect(palic.locator('[data-absence]')).toBeChecked();
    await expect(page.locator('#coverage-list .coverage-row').filter({ hasText: 'PALIC' })).toHaveCount(1);
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

  test('en copiar un interval, les jornades ja publicades actualitzen la vista del professorat', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')));
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles({
      name: 'GPU001.TXT',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${dutiesText}\n41,"1ESO-B","FUEN","MAT","AUL14",2,1,,`),
    });
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    // Dimarts publicat amb una altra absència (el clic no compta fins que el dia ha carregat).
    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('Fuentes');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect.poll(async () => (await data()).days?.['2026-09-08']?.absenceIds?.length || 0).toBe(1);
    await expect(async () => {
      await page.getByRole('button', { name: 'Publica' }).click();
      await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada', { timeout: 1_000 });
    }).toPass();
    await expect.poll(async () => (await data()).publicDays?.['2026-09-08']?.status).toBe('published');

    // Des del dilluns, l'absència de tot el dia es copia fins dimarts.
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect(page.locator('#coverage-list .coverage-item')).toHaveCount(3);
    await page.locator('.range-builder input[type="date"]').nth(1).fill('2026-09-08');
    await page.getByRole('button', { name: 'Aplica interval' }).click();
    await expect(page.locator('.range-builder .range-feedback')).toHaveText('Totes les hores aplicades a 2 dies lectius · 4 sessions.');

    // Sense obrir el dimarts, la seva vista pública ja inclou l'absència amb la revisió desada.
    const stored = await data();
    const tuesday = stored.publicDays['2026-09-08'];
    const absent = tuesday.hours.flatMap((hour) => hour.rows || []).map((row) => row.absent).join(' ');
    expect(absent).toContain('Adell');
    expect(absent).toContain('Fuentes');
    expect(tuesday.revision).toBe(stored.days['2026-09-08'].revision);
    // El càlcul de l'altra jornada no ha tocat la visible.
    await expect(page.locator('#date-input')).toHaveValue('2026-09-07');
    await expect(page.locator('#coverage-list .coverage-item')).toHaveCount(3);
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
        titleFont: getComputedStyle(node.querySelector('h3')).fontFamily,
      };
    });
    // Redisseny: capçalera d'hora sobria, amb el títol en la tipografia de titulars.
    expect(sessionHeaderStyle.minHeight).toBeGreaterThanOrEqual(40);
    expect(sessionHeaderStyle.titleFont).toContain('Bricolage Grotesque');
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
    // La data és a la barra superior; el professorat no té capçalera de gestió.
    await expect(page.locator('.app-nav #date-input')).toBeVisible();
    await expect(page.locator('.work-title, .day-command-bar')).toHaveCount(0);
    await expect(page.locator('.teacher-stats-panel')).toBeHidden();
    await page.getByRole('tab', { name: 'Recompte de guàrdies' }).click();
    await expect(page.locator('.teacher-stats-panel')).toBeVisible();
    await expect(page.locator('.app-nav #date-input')).toBeHidden();
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

  test('recupera els canvis del pati pendents de desar després de recarregar', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await page.locator('#new-pati-zone').fill('Pista');
    await page.locator('#add-pati-zone').click();
    // Es recarrega abans que el desament automàtic tingui temps d'enviar-ho.
    expect(await page.evaluate(() => sessionStorage.getItem('guardies_pending_pati:e2e-2026'))).toContain('Pista');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).pati?.zones?.length || 0)).toBe(0);
    await page.reload();

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await expect(page.getByLabel('Nom de la zona 1')).toHaveValue('Pista');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).pati
      ?.zones?.map((zone) => zone.name))).toEqual(['Pista']);
    await expect(page.locator('#pati-panel')).not.toContainText("No s'ha pogut desar");
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
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).pati
      ?.weekdayTeachers?.['1']?.find((teacher) => teacher.teacherId === '2')?.zoneOverrides?.['2026-09-14'])).toBe('zona-2');
    await page.locator('[data-comment="pati_observation"]')
      .fill('Banys ha de quedar cobert durant tot el pati.');
    await expect(page.locator('[data-comment-print="pati_observation"]'))
      .toContainText('Banys ha de quedar cobert');

    await page.locator('#professor-search').fill('Fuentes');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: 'Guàrdia de pati' }).locator('[data-absence]').check();
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

    // The previous "Desat" message can still be visible while the new holiday
    // is waiting in the debounce. Wait for the actual payload before reload.
    await expect.poll(() => page.evaluate(() => {
      const patio = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).pati;
      return {
        zone: patio?.weekdayTeachers?.['1']?.find((teacher) => teacher.teacherId === '2')?.zoneOverrides?.['2026-09-14'],
        holiday: patio?.customHolidays?.some((item) => item.date === '2026-09-21') || false,
      };
    })).toEqual({ zone: 'zona-2', holiday: true });
    await page.reload();
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('.pati-zone-card').filter({ hasText: 'Fuentes Serra' })
      .locator('[data-pati-zone-override]')).toHaveValue('zona-2');
    await expect(page.locator('[data-comment="pati_observation"]'))
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

  test('el torn de pati el decideix la configuració, no les files GP d\'Untis', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await page.locator('#new-pati-zone').fill('Pista');
    await page.locator('#add-pati-zone').click();
    await page.locator('#pati-teacher-search').fill('Sanz');
    await page.locator('#pati-teacher-search').press('Enter');
    await expect(page.locator('.pati-roster-row')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    // Fuentes té una fila GP d'Untis dilluns, però no fa pati aquest dia.
    await page.locator('#professor-search').fill('Fuentes');
    await page.locator('#professor-results [data-professor]').first().click();
    await expect(page.locator('#schedule-grid .schedule-item').filter({ hasText: 'Guàrdia de pati' })).toHaveCount(0);

    // Sanz fa pati dilluns sense cap fila GP: l'absència de tot el dia l'ha d'incloure.
    await page.locator('#professor-search').fill('Sanz');
    await page.locator('#professor-results [data-professor]').first().click();
    await expect(page.locator('#schedule-grid .schedule-item').filter({ hasText: 'Guàrdia de pati' })).toHaveCount(1);
    await page.locator('#add-all-hours').click();
    const sanzCard = page.locator('#coverage-list .pati-zone-card').filter({ hasText: 'Sanz' });
    await expect(sanzCard).toHaveClass(/absent/);
    await expect(sanzCard.locator('.pati-absence-badge')).toHaveText('Absent');
  });

  test('el pati surt al seu lloc cronològic a l\'horari del professor', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles(sevenSessionsDutiesFile);
    await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
    await page.locator('#pati-panel summary').click();
    await page.locator('#new-pati-zone').fill('Pista');
    await page.locator('#add-pati-zone').click();
    await page.locator('#pati-teacher-search').fill('Adell');
    await page.locator('#pati-teacher-search').press('Enter');
    await expect(page.locator('.pati-roster-row')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    await page.locator('#professor-search').fill('Adell');
    await page.locator('#professor-results [data-professor]').first().click();
    const items = page.locator('#schedule-grid .schedule-item');
    await expect(items.filter({ hasText: 'Guàrdia de pati' })).toHaveCount(1);
    const texts = await items.allInnerTexts();
    expect(texts.length).toBeGreaterThan(4);
    const patioIndex = texts.findIndex((text) => text.includes('Guàrdia de pati'));
    expect(patioIndex).toBe(3);
    expect(texts[patioIndex]).toMatch(/^10:45/);
    expect(texts[patioIndex]).not.toContain('Sense grup');
  });

  test('una sortida desada amb el codi de grup d\'Untis es manté en obrir el dia', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      data.days ||= {};
      data.days['2026-09-08'] = {
        schemaVersion: 1, date: '2026-09-08', status: 'draft', absenceIds: [], assignments: {}, comments: {},
        groupsOut: ['1ESO-A'], groupTeachers: {}, groupReleasedTeachers: {}, partialGroups: [], outingAbsenceIds: [],
        cancelledAssignments: [], publishedAt: '', closedAt: '', countedAssignments: [], revision: 1,
        clientUpdatedAt: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await expect(page.locator('[data-group-released="10"]')).toHaveCount(1);
  });

  test('treure un acompanyant no esborra les absències que s\'havien marcat a mà', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const absences = () => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return Array.from(useGuardiesStore().absencies.keys()).sort();
    });
    const before = await absences();
    expect(before.length).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('11');
    await page.locator('[data-add-group-companion="11"]').selectOption('1');
    await expect(page.locator('[data-remove-group-companion="11"]')).toHaveCount(1);
    await page.locator('[data-remove-group-companion="11"]').click();
    await expect(page.locator('[data-remove-group-companion="11"]')).toHaveCount(0);
    expect(await absences()).toEqual(before);
  });

  test('si el grup ja és fora i el professor alliberat falta, consta absent i no es proposa', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await page.getByRole('tab', { name: 'Professor/a' }).click();
    for (const name of ['MAT', 'ADELL']) {
      await page.locator('#professor-search').fill(name);
      await page.locator('#professor-results [data-professor]').first().click();
      await page.locator('#add-all-hours').click();
    }
    const adellRows = page.locator('#coverage-list .coverage-item')
      .filter({ has: page.locator('.coverage-professor-cell', { hasText: 'Adell Domènech' }) });
    await expect(adellRows).toHaveCount(3);
    await expect(adellRows.filter({ hasText: 'Grup de sortida' })).toHaveCount(2);
    const mathRow = page.locator('#coverage-list .coverage-item').filter({ hasText: 'MAT1' }).first();
    await expect(mathRow.locator('option').filter({ hasText: 'Adell Domènech' })).toContainText('No disponible');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await expect(page.locator('#released-count')).toHaveText('0 professors');
    await expect(page.locator('#released-list .released-item.absent')).toHaveCount(2);
  });

  test('qui ja acompanya i es marca a mà continua absent si es treu de la sortida', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('11');
    await page.locator('[data-add-group-companion="11"]').selectOption('1');
    await expect(page.locator('[data-remove-group-companion="11"]')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Professor/a' }).click();
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    const absences = () => page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      return Array.from(useGuardiesStore().absencies.keys()).sort();
    });
    const before = await absences();
    expect(before.length).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('[data-remove-group-companion="11"]').click();
    await expect(page.locator('[data-remove-group-companion="11"]')).toHaveCount(0);
    expect(await absences()).toEqual(before);
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

    // L'Adell acompanya l'1ESO-A: les seves classes amb aquest grup no es cobreixen (el grup
    // és fora amb ell); només queda la seva guàrdia de 3a hora, que no podrà fer.
    await page.locator('[data-add-group-companion="10"]').selectOption('1');
    await expect(page.locator('[data-group-companion="10"][data-teacher="1"]')).toBeVisible();
    await expect(page.locator('#released-count')).toContainText('0 professors');
    await expect(page.locator('#coverage-list .coverage-item.coverage-row:not(.not-completed)')).toHaveCount(1);

    await page.waitForTimeout(500);
    await page.reload();
    await page.locator('#date-input').fill('2026-09-07');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await expect(page.locator('[data-group-companion="10"][data-teacher="1"]')).toBeVisible();

    await page.locator('[data-add-group-companion="10"]').selectOption('2');
    await expect(page.locator('[data-group-companion="10"][data-teacher="2"]')).toBeVisible();
    await expect(page.locator('#coverage-list .coverage-item.coverage-row:not(.not-completed)')).toHaveCount(2);

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
    const adminLine = page.locator('#outings-line .outings-line');
    await expect(adminLine).toContainText('Sortides complementàries:');
    await expect(adminLine.locator('[data-outing-group="10"]')).toHaveText(/^1ESO-A de \d{1,2}:\d{2} a \d{1,2}:\d{2}$/);
    const adminText = await adminLine.locator('[data-outing-group="10"]').textContent();
    await page.getByRole('link', { name: 'Professorat', exact: true }).click();
    const teacherLine = page.locator('#outings-line .outings-line');
    await expect(teacherLine).toContainText('Sortides complementàries:');
    await expect(teacherLine.locator('[data-outing-group="10"]')).toHaveText(adminText);
  });

  test('una sortida: es cobreixen les classes dels grups que es queden i no les dels grups que són fora', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    // Dilluns: MAT1 fa 1ESO-A+B a 1a hora i 1ESO-B a 3a; l'Adell fa 1ESO-A a 1a i 2a.
    const files = page.locator('#coverage-list [data-coverage-row]');
    const fila = (text) => files.filter({ hasText: text });
    const obertes = page.locator('#coverage-list [data-coverage-row].status-open');

    // L'1ESO-A surt sencer i MAT1 l'acompanya: s'han de cobrir les seves classes amb l'1ESO-B.
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await page.locator('[data-add-group-companion="10"]').selectOption('4');
    await expect(obertes).toHaveCount(2);
    await expect(fila('1ESO-B')).toHaveCount(2);

    // Si també surt sencer l'1ESO-B, cap classe de MAT1 no es fa: res a cobrir.
    await page.locator('#group-search').selectOption('11');
    await expect(obertes).toHaveCount(0);

    // Si l'1ESO-B només surt en part, les classes amb l'1ESO-B es tornen a cobrir.
    await page.locator('[data-group-complete="11"]').uncheck();
    await expect(obertes).toHaveCount(2);

    // Un professor que falta amb un grup que és fora sencer: la classe no es cobreix.
    await page.getByRole('tab', { name: 'Professor/a' }).click();
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:55' }).locator('[data-absence]').check();
    const adell = page.locator('#coverage-list [data-coverage-row].status-outing');
    await expect(adell).toHaveCount(1);
    await expect(adell).toContainText('Grup de sortida');
    await expect(adell).toContainText('Sense substitució · el grup és fora');
    await expect(adell.locator('[data-assignacio]')).toHaveCount(0);
    await expect(obertes).toHaveCount(2);
    // L'assignació automàtica no hi posa ningú.
    await page.locator('#auto-assign-guards').click();
    await expect(adell).toHaveCount(1);
    await expect(adell).not.toHaveClass(/covered/);

    // A la vista del professorat no surt: aquella classe no es fa.
    await page.getByRole('button', { name: 'Publica' }).click();
    const publicat = () => page.evaluate(() => (
      JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).publicDays?.['2026-09-07']
    ));
    await expect.poll(async () => (await publicat())?.status).toBe('published');
    const filesPubliques = (await publicat()).hours.flatMap((hour) => hour.rows);
    expect(filesPubliques.some((row) => row.absent.includes('Adell') && row.group.includes('1ESO-A'))).toBe(false);
    expect(filesPubliques.filter((row) => row.group.includes('1ESO-B'))).toHaveLength(2);

    // Sense grups de sortida, les absències de l'acompanyant marxen amb la seva cobertura.
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#clear-groups').click();
    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(1);
    await expect(page.locator('#coverage-list [data-coverage-row].status-open')).toHaveCount(1);
  });

  test('en copiar una sortida a altres dies, cada dia allibera el professorat del seu horari', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    // Dilluns l'Adell fa 1ESO-A a 1a i 2a hora; dimarts, a 5a.
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await expect(page.locator('#released-count')).toContainText('1 professor');
    await page.locator('#outing-to').fill('2026-09-08');
    await page.getByRole('button', { name: 'Copia als dies de l’interval' }).click();
    await expect(page.getByText('Sortida copiada a 1 dia lectiu.')).toBeVisible();
    await page.locator('#date-input').fill('2026-09-08');
    await page.locator('#date-input').press('Tab');
    await expect(page.locator('[data-remove-group="10"]')).toBeVisible();
    await expect(page.locator('#released-count')).toContainText('1 professor');
    await expect(page.locator('[data-group-released="10"]:checked')).toHaveCount(1);
  });

  test('qui acompanya una sortida no pot cobrir cap guàrdia aquell dia, ni a les hores lliures', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    // L'Adell falta a 2a hora; el Fuentes (2) no hi té classe ni G.
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#schedule-grid .schedule-item').filter({ hasText: '8:55' }).locator('[data-absence]').check();
    const cover = page.locator('#coverage-list [data-assignacio]').first();
    await cover.selectOption('2');
    await expect(cover).toHaveValue('2');

    // El Fuentes acompanya l'1ESO-B: deixa de cobrir-la i ja no surt com a disponible.
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('11');
    await page.locator('[data-add-group-companion="11"]').selectOption('2');
    await expect(page.locator('[data-group-companion="11"][data-teacher="2"]')).toBeVisible();
    await expect(cover).toHaveValue('');
    const fuentes = cover.locator('option[value="2"]');
    await expect(fuentes).toBeDisabled();
    await expect(fuentes).toContainText('No disponible · de sortida');

    // L'assignació automàtica tampoc no el tria.
    await page.locator('#auto-assign-guards').click();
    await expect(cover).not.toHaveValue('2');
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
      // També ha de cabre quan la mida A3 arriba de la impressora i no del CSS.
      const printerPdf = await page.pdf({ format: 'A3', printBackground: true, preferCSSPageSize: false });
      expect(printerPdf.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g)).toHaveLength(1);
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

    // A3: 420 mm - 2 × 10 mm de marge = 400 mm disponibles.
    // El full fa 390 mm i conserva 10 mm de reserva per a l'àrea imprimible real.
    expect(layout.panelHeight).toBeGreaterThan(1450);
    expect(layout.panelHeight).toBeLessThan(1490);
    expect(Math.max(...layout.sessionHeights) - Math.min(...layout.sessionHeights)).toBeLessThan(2);
    expect(layout.patioHeight).toBeLessThan(Math.min(...layout.sessionHeights));
    expect(layout.seventhHeight).toBeLessThan(Math.min(...layout.sessionHeights));
    expect(layout.seventhHeight).toBeGreaterThan(25);
    expect(layout.bottomGap).toBeLessThan(2);
  });
});

test.describe('Guàrdies: canvis d’horari amb la jornada oberta', () => {
  const savedDay = (page) => page.evaluate(() => (
    JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'] || null
  ));

  // Adell absent tot el dilluns, amb una observació a la classe de 8:55. Retorna l'id desat.
  async function markAdellWithComment(page, comment) {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await page.locator('[data-coverage-session="8:55"] [data-comment]').fill(comment);
    await expect.poll(async () => Object.values((await savedDay(page))?.comments || {})).toContain(comment);
    const day = await savedDay(page);
    expect(day.absenceIds).toHaveLength(3);
    return Object.keys(day.comments).find((id) => day.comments[id] === comment);
  }

  async function uploadDuties(page, text, name = 'GPU001-nou.TXT') {
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#duties-file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('[data-upload-name="duties"]')).toHaveText(name);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();
  }

  test('pujar un GPU001 nou no buida la jornada i la classe que canvia d’aula hi conserva l’absència', async ({ page }) => {
    const oldId = await markAdellWithComment(page, 'Material a la taula');
    await uploadDuties(page, dutiesText.replace('"ADEL","MAT","AUL14",1,2', '"ADEL","MAT","AUL15",1,2'));

    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(3);
    await expect(page.locator('[data-coverage-session="8:55"] [data-comment]')).toHaveValue('Material a la taula');
    await expect(page.locator('.unmatched-absences')).toHaveCount(0);
    await expect.poll(async () => (await savedDay(page)).absenceIds).not.toContain(oldId);
    const saved = await savedDay(page);
    expect(saved.absenceIds).toHaveLength(3);
    const newId = Object.keys(saved.comments).find((id) => saved.comments[id] === 'Material a la taula');
    expect(newId.split('|').slice(0, 3)).toEqual(oldId.split('|').slice(0, 3));

    await page.reload();
    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(3);
    await expect(page.locator('[data-coverage-session="8:55"] [data-comment]')).toHaveValue('Material a la taula');
  });

  test('una absència que ja no és a l’horari es conserva, s’avisa i es pot descartar', async ({ page }) => {
    const oldId = await markAdellWithComment(page, 'Material a la taula');
    await uploadDuties(page, dutiesText.replace('11,"1ESO-A","ADEL","MAT","AUL14",1,2,,\n', ''));

    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(2);
    const warning = page.locator('.unmatched-absences');
    await expect(warning).toContainText('Una absència desada no surt al full');
    await expect(warning).toContainText('Adell Domènech, Marina');
    await expect(warning).toContainText('Material a la taula');

    // Una altra edició desa la jornada sense perdre l'absència que no encaixa.
    await page.locator('[data-coverage-session="8:00"] [data-comment]').fill('Una altra observació');
    await expect.poll(async () => Object.values((await savedDay(page)).comments)).toContain('Una altra observació');
    const saved = await savedDay(page);
    expect(saved.absenceIds).toContain(oldId);
    expect(saved.comments[oldId]).toBe('Material a la taula');

    await page.reload();
    await expect(page.locator('.unmatched-absences')).toContainText('Adell Domènech, Marina');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.unmatched-absences').getByRole('button', { name: 'Descarta-la' }).click();
    await expect(page.locator('.unmatched-absences')).toHaveCount(0);
    await expect.poll(async () => (await savedDay(page)).absenceIds).not.toContain(oldId);
    expect((await savedDay(page)).comments[oldId]).toBeUndefined();
    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(2);
  });

  test('treure i tornar a pujar el GPU001 no perd la jornada oberta', async ({ page }) => {
    await markAdellWithComment(page, 'Material a la taula');
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#admin-panel > summary').click();
    await page.locator('[data-remove-upload="duties"]').click();
    await expect(page.locator('[data-upload-name="duties"]')).not.toHaveText('GPU001.TXT');
    await uploadDuties(page, dutiesText);

    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(3);
    await expect(page.locator('[data-coverage-session="8:55"] [data-comment]')).toHaveValue('Material a la taula');
    await expect(page.locator('.unmatched-absences')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect((await savedDay(page)).absenceIds).toHaveLength(3);
  });

  test('qui cobreix la classe d’un acompanyant de sortida es conserva en tornar a obrir la jornada', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('11');
    await page.locator('[data-add-group-companion="11"]').selectOption('1');
    await expect(page.locator('[data-group-companion="11"][data-teacher="1"]')).toBeVisible();
    await page.locator('[data-coverage-session="8:55"] [data-assignacio]').selectOption('3');
    await expect.poll(async () => Object.values((await savedDay(page))?.assignments || {}).map((item) => item.teacherId)).toContain('3');

    await page.reload();
    await expect(page.locator('[data-coverage-session="8:55"] [data-assignacio]')).toHaveValue('3');
  });
});

test('una jornada sense cap absència es pot publicar i tancar', async ({ page }) => {
  await openGuardies(page);
  await uploadConfiguration(page);
  await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(0);
  const day = () => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'] || null);
  expect(await day()).toBeNull();

  await page.getByRole('button', { name: 'Publica' }).click();
  await expect(page.locator('.day-status-badge')).toHaveText('Publicada');
  await expect(page.locator('#error-box')).toBeHidden();
  expect(await day()).toMatchObject({ status: 'published', absenceIds: [], revision: 1 });
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).publicDays?.['2026-09-07']))?.status).toBe('published');

  await page.getByRole('button', { name: 'Tanca jornada' }).click();
  await expect(page.locator('.day-status-badge')).toHaveText('Tancada');
  expect(await day()).toMatchObject({ status: 'closed', countedAssignments: [] });

  // Un altre dia sense absències també es pot tancar directament.
  await page.locator('#date-input').fill('2026-09-08');
  await page.locator('#date-input').press('Tab');
  await expect(page.locator('.day-status-badge')).toHaveText('Esborrany');
  await page.getByRole('button', { name: 'Publica' }).click();
  await expect(page.locator('.day-status-badge')).toHaveText('Publicada');
});

test.describe('Guàrdies: historial de la jornada', () => {
  const savedDay = (page) => page.evaluate(() => (
    JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'] || null
  ));

  test('cada canvi desa la versió anterior i se\'n pot restaurar una', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await page.locator('[data-coverage-session="8:55"] [data-comment]').fill('Material a la taula');
    await expect.poll(async () => Object.values((await savedDay(page))?.comments || {})).toContain('Material a la taula');

    // Un error buida la jornada.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Neteja dia', exact: true }).click();
    await expect.poll(async () => (await savedDay(page)).absenceIds).toEqual([]);

    await page.getByRole('button', { name: 'Historial', exact: true }).click();
    const history = page.locator('.day-history');
    const before = history.locator('.day-history-item').filter({ hasText: '3 absències' }).filter({ hasText: '1 observació' });
    await expect(before).toHaveCount(1);
    await expect(before).toContainText('Substituïda');
    page.once('dialog', (dialog) => dialog.accept());
    await before.getByRole('button', { name: 'Restaura' }).click();
    await expect(history.locator('.day-history-feedback')).toContainText('Jornada restaurada');
    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(3);
    await expect(page.locator('[data-coverage-session="8:55"] [data-comment]')).toHaveValue('Material a la taula');
    await expect.poll(async () => (await savedDay(page)).absenceIds).toHaveLength(3);
    // La jornada buida també queda a l'historial: la restauració es pot desfer.
    await expect(history.locator('.day-history-item').first()).toContainText('0 absències');

    await page.reload();
    await expect(page.locator('#coverage-list [data-coverage-row]')).toHaveCount(3);
  });

  test('es guarden com a màxim les 30 darreres versions de cada jornada', async ({ page }) => {
    await openGuardies(page);
    const result = await page.evaluate(async () => {
      const storage = await import('/src/services/guardiesStorage.js');
      const day = {
        status: 'draft', absenceIds: [], assignments: {}, comments: {}, groupsOut: [], groupTeachers: {},
        groupReleasedTeachers: {}, partialGroups: [], outingAbsenceIds: [], cancelledAssignments: [],
        overriddenCoTeacherAssignments: [], publishedAt: '', closedAt: '', countedAssignments: [],
      };
      let revision = 0;
      for (let change = 0; change < 35; change += 1) {
        revision = (await storage.saveGuardiesDay('e2e-2026', '2026-09-09', {
          ...day, comments: { pati_observation: `canvi ${change}` },
        }, revision)).revision;
      }
      const versions = await storage.loadGuardiesDayVersions('e2e-2026', '2026-09-09');
      return { revision, count: versions.length, newest: versions[0].revision, oldest: versions.at(-1).revision };
    });
    expect(result).toEqual({ revision: 35, count: 30, newest: 34, oldest: 5 });
  });
});

test.describe('Guàrdies: correus al professorat', () => {
  const e2eData = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')));
  const mails = async (page) => Object.values((await e2eData(page)).mails || {});
  // El rellotge de la pàgina comença al moment indicat i continua avançant.
  const startClockAt = (page, iso) => page.addInitScript((target) => {
    const RealDate = Date;
    const offset = target - RealDate.now();
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }, new Date(iso).getTime());
  const minutesAfter = (iso, from) => (new Date(iso).getTime() - new Date(from).getTime()) / 60000;

  async function releasedAssignment(page) {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Grup de sortida' }).click();
    await page.locator('#group-search').selectOption('10');
    await page.getByRole('tab', { name: 'Professor/a', exact: true }).click();
    await page.locator('#professor-search').fill('MAT1');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await page.locator('#auto-assign-guards').click();
    await expect(page.locator('.auto-assignment-feedback')).toHaveText('2 assignades');
  }

  test('assignar una guàrdia com a alliberat/da posa un correu a la cua (i només aquest)', async ({ page }) => {
    // Dilluns a les 10:00: dins de l'horari, surt al cap de 2 minuts.
    await startClockAt(page, '2026-09-07T10:00:00+02:00');
    await releasedAssignment(page);
    await expect.poll(async () => (await mails(page)).length).toBe(1);
    const [mail] = await mails(page);
    expect(mail).toMatchObject({
      kind: 'alliberat', template: 'alliberat', date: '2026-09-07', teacherId: '1', status: 'pendent',
      email: 'marina.adell@iesjosepsuredaiblanes.com',
      fields: { nom: 'Marina', nom_complet: 'Marina Adell Domènech', data: '07/09/2026', dia: 'dilluns', hora: '1a hora', horari: '8:00', grup: '1ESO-A + 1ESO-B' },
    });
    expect(mail.check.absenceId).toContain('|1|8:00|');
    const delay = minutesAfter(mail.sendAfter, '2026-09-07T10:00:00+02:00');
    expect(delay).toBeGreaterThanOrEqual(2);
    expect(delay).toBeLessThan(3);

    // Tornar a desar la jornada no en programa cap altre.
    await page.locator('#coverage-list [data-comment]').first().fill('Material a la taula');
    await expect.poll(async () => Object.values((await e2eData(page)).days['2026-09-07'].comments)).toContain('Material a la taula');
    expect(await mails(page)).toHaveLength(1);
  });

  test('un canvi per a un altre dia queda per a les 8:00 d\'aquell dia', async ({ page }) => {
    // Divendres a les 10:00, per a dilluns: dilluns a les 8:00 (no al cap de 2 minuts).
    await startClockAt(page, '2026-09-04T10:00:00+02:00');
    await releasedAssignment(page);
    await expect.poll(async () => (await mails(page)).map((mail) => [mail.date, mail.sendAfter])).toEqual([['2026-09-07', '2026-09-07T06:00:00.000Z']]);
  });

  test('canviar a mà la zona de pati d\'algú li programa un correu; tornar a la rotació, no', async ({ page }) => {
    await startClockAt(page, '2026-09-14T09:00:00+02:00');
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#date-input').fill('2026-09-14');
    await page.locator('#date-input').press('Tab');
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#pati-panel summary').click();
    await page.locator('#new-pati-zone').fill('Pista');
    await page.locator('#add-pati-zone').click();
    await page.locator('#new-pati-zone').fill('Porxada');
    await page.locator('#add-pati-zone').click();
    await page.locator('#pati-teacher-search').fill('Fuentes');
    await page.locator('.pati-teacher-results [role="option"]').first().click();
    await expect(page.locator('.pati-roster-row')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Gestió diària' }).click();

    const card = page.locator('#coverage-list .pati-zone-card').filter({ hasText: 'Fuentes Serra' });
    await card.locator('[data-pati-zone-override]').selectOption({ label: 'Porxada' });
    await expect.poll(async () => (await mails(page)).length).toBe(1);
    const [mail] = await mails(page);
    expect(mail).toMatchObject({
      kind: 'pati', date: '2026-09-14', teacherId: '2', email: 'gabriel.fuentes@iesjosepsuredaiblanes.com',
      fields: { nom: 'Gabriel', data: '14/09/2026', dia: 'dilluns', zona: 'Porxada', zona_habitual: 'Pista' },
    });
    expect(mail.check).toEqual({ day: '1', zoneId: mail.check.zoneId });
    expect(minutesAfter(mail.sendAfter, '2026-09-14T09:00:00+02:00')).toBeGreaterThanOrEqual(2);

    await card.locator('[data-pati-zone-override]').selectOption({ index: 0 });
    await expect(card).not.toHaveClass(/overridden/);
    await page.waitForTimeout(300);
    expect(await mails(page)).toHaveLength(1);
  });

  test('els textos es configuren a Configuració, amb camps i previsualització', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#mail-panel summary').click();
    const panel = page.locator('#mail-panel');
    // Fins que algú l'activa, no s'envia res al professorat.
    await expect(panel.getByRole('switch', { name: 'Enviament al professorat' })).not.toBeChecked();
    await expect(panel.locator('.mail-master')).toContainText('Enviament al professorat: aturat');

    const template = page.locator('[data-mail-template="alliberat"]');
    await expect(template.locator('.mail-preview')).toContainText('Se us ha assignat una guàrdia amb el grup 3ESO-B, com a alliberat/da, el 20/10/2026 a 4a hora.');

    await template.getByLabel('Text: Guàrdia com a alliberat/da').fill('Hola ');
    await template.getByRole('button', { name: '{nom}' }).click();
    await expect(template.getByLabel('Text: Guàrdia com a alliberat/da')).toHaveValue('Hola {nom}');
    await expect(template.locator('.mail-preview p')).toHaveText('Hola Marina');
    await panel.getByRole('switch', { name: 'Correu actiu: Canvi de zona de pati' }).uncheck();
    await expect(page.locator('[data-mail-template="pati"]')).toHaveClass(/is-off/);
    await expect(panel.locator('.mail-unsaved')).toHaveText('Hi ha canvis sense desar.');
    await panel.getByRole('button', { name: 'Desa', exact: true }).click();
    await expect(page.locator('.mail-feedback')).toHaveText('Desat.');

    await page.reload();
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#mail-panel summary').click();
    await expect(page.locator('[data-mail-template="alliberat"]').getByLabel('Text: Guàrdia com a alliberat/da')).toHaveValue('Hola {nom}');
    await expect(panel.getByRole('switch', { name: 'Correu actiu: Canvi de zona de pati' })).not.toBeChecked();

    await page.locator('[data-mail-template="alliberat"]').getByRole('button', { name: 'Envia’m una prova' }).click();
    await expect(page.locator('.mail-feedback')).toContainText('Prova a la cua per a e2e.admin@iesjosepsuredaiblanes.com');
    await expect(page.locator('.mail-recent li').first()).toContainText('Prova');

    // Les proves poden anar a una altra adreça del centre.
    await panel.getByLabel('Adreça per a les proves').fill('algu@gmail.com');
    await expect(panel.locator('.mail-sender small.is-error')).toHaveText('Ha de ser una adreça del centre.');
    await panel.getByLabel('Adreça per a les proves').fill('jaerustes@iessureda.com');
    await expect(page.locator('[data-mail-template="pati"] .mail-template-foot small')).toHaveText('Envia aquest exemple a jaerustes@iessureda.com');
    await page.locator('[data-mail-template="pati"]').getByRole('button', { name: 'Envia’m una prova' }).click();
    await expect(page.locator('.mail-feedback')).toContainText('Prova a la cua per a jaerustes@iessureda.com');
    await expect(page.locator('[data-mail-list="previstos"] li').filter({ hasText: 'Exemple de «Canvi de zona de pati»' })).toHaveCount(1);
    expect((await mails(page)).map((mail) => [mail.kind, mail.template, mail.email]).sort()).toEqual([
      ['prova', 'alliberat', 'e2e.admin@iesjosepsuredaiblanes.com'],
      ['prova', 'pati', 'jaerustes@iessureda.com'],
    ]);
    expect((await e2eData(page)).mailConfig.testEmail).toBe('jaerustes@iessureda.com');
  });

  test('a «Darrers correus» només hi ha els previstos (per ordre de sortida) i els enviats', async ({ page }) => {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.evaluate(() => {
      const key = 'quota-e2e-guardies:e2e-2026';
      const data = JSON.parse(localStorage.getItem(key));
      const mail = (id, status, extra, fields = {}) => ({
        id, kind: 'alliberat', template: 'alliberat', date: '2026-09-08', status, reason: '', createdAt: `2026-09-07T0${id.length}:00:00.000Z`,
        email: `${id}@iesjosepsuredaiblanes.com`,
        fields: { nom: 'Pere', nom_complet: `Professor ${id}`, data: '08/09/2026', dia: 'dimarts', hora: '1a hora', horari: '8:00', grup: '1ESO-A', ...fields },
        ...extra,
      });
      // «aviat» i «tard»: dos avisos previstos del mateix professor per al mateix dia.
      data.mails = Object.fromEntries([
        mail('tard', 'pendent', { email: 'pere@iesjosepsuredaiblanes.com', sendAfter: '2026-09-09T06:00:00.000Z' }, { hora: '3a hora', horari: '9:50', grup: '2ESO-B' }),
        mail('aviat', 'pendent', { email: 'pere@iesjosepsuredaiblanes.com', sendAfter: '2026-09-08T06:00:00.000Z' }),
        mail('enviat', 'enviat', {
          sendAfter: '2026-09-07T06:00:00.000Z', sentAt: '2026-09-07T06:01:00.000Z',
          subject: 'Avisos de guàrdies per al dimarts 08/09/2026', text: 'Benvolgut/da Professor,\n\nAvís enviat de veritat.',
        }),
        mail('antic', 'enviat', { sendAfter: '2026-09-07T05:00:00.000Z', sentAt: '2026-09-07T05:01:00.000Z' }),
        mail('descartat', 'cancel·lat', { reason: 'Enviament al professorat aturat' }),
        mail('fallat', 'error', { reason: 'Daily user sending limit exceeded' }),
      ].map((item) => [item.id, item]));
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('#mail-panel summary').click();
    await expect(page.locator('[data-mail-list="previstos"] li strong')).toHaveText(['Professor aviat', 'Professor tard']);
    await expect(page.locator('[data-mail-list="enviats"] li strong')).toHaveText(['Professor enviat', 'Professor antic']);
    await expect(page.locator('.mail-recent')).not.toContainText('descartat');
    await expect(page.locator('.mail-recent')).not.toContainText('fallat');

    // En fer-hi clic, cada fila mostra el correu: el que va sortir o com sortirà.
    const sent = page.locator('[data-mail-list="enviats"] li').first();
    await expect(sent.locator('.mail-log-message')).toBeHidden();
    await sent.locator('summary').click();
    await expect(sent.locator('.mail-log-message .mail-preview-subject')).toHaveText('Avisos de guàrdies per al dimarts 08/09/2026');
    await expect(sent.locator('.mail-log-message p')).toHaveText('Benvolgut/da Professor, Avís enviat de veritat.');
    await expect(sent.locator('.mail-log-note')).toHaveCount(0);
    const old = page.locator('[data-mail-list="enviats"] li').nth(1);
    await old.locator('summary').click();
    await expect(old.locator('.mail-log-note')).toContainText('Text refet amb la plantilla actual');
    const scheduled = page.locator('[data-mail-list="previstos"] li').first();
    await scheduled.locator('summary').click();
    await expect(scheduled.locator('.mail-log-message .mail-preview-subject')).toHaveText('Avisos de guàrdies per al dimarts 08/09/2026');
    await expect(scheduled.locator('.mail-log-note')).toHaveText('Així sortirà si no canvia res abans.');
    await expect(scheduled.locator('.mail-log-message p')).toHaveText(
      'Benvolgut/da Pere, Se us ha assignat una guàrdia amb el grup 1ESO-A, com a alliberat/da, el 08/09/2026 a 1a hora. '
      + 'Se us ha assignat una guàrdia amb el grup 2ESO-B, com a alliberat/da, el 08/09/2026 a 3a hora. Gràcies.',
    );
  });
});

test('les observacions del pati i de la 7a hora es desen amb claus que Firestore accepta', async ({ page }) => {
  await openGuardies(page);
  await uploadConfiguration(page);
  // Una còpia local d'abans del canvi: Firestore rebutja les claus que comencen i acaben amb "__".
  await page.evaluate(async () => {
    const { saveGuardiesDay } = await import('/src/services/guardiesStorage.js');
    const saved = JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days?.['2026-09-07'];
    await saveGuardiesDay('e2e-2026', '2026-09-07', {
      status: 'draft', comments: { __pati_observation__: 'Pati antic', __seventh_observation__: 'Setena antiga' },
    }, Number(saved?.revision) || 0);
  });
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
    const store = useGuardiesStore();
    return [store.comentaris.get('pati_observation'), store.comentaris.get('seventh_observation')];
  })).toEqual(['Pati antic', 'Setena antiga']);

  await page.locator('#professor-search').fill('ADELL');
  await page.locator('#professor-results [data-professor]').first().click();
  await page.locator('#add-all-hours').click();
  await expect.poll(async () => page.evaluate(() => (
    JSON.parse(localStorage.getItem('quota-e2e-guardies:e2e-2026')).days['2026-09-07'].comments
  ))).toEqual({ pati_observation: 'Pati antic', seventh_observation: 'Setena antiga' });
});

test.describe('Guàrdies: revisió visual', () => {
  const startAt = (page, iso) => page.addInitScript((target) => {
    const RealDate = Date;
    const offset = target - RealDate.now();
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }, new Date(iso).getTime());

  // Textos visibles de menys de 12 px (la impressió A3 no compta).
  const tinyTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((element) => {
    const text = Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!text || !element.getClientRects().length || element.closest('.print-only, .hidden')) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && parseFloat(style.fontSize) < 11.99;
  }).map((element) => `${element.className || element.tagName}: ${element.textContent.trim().slice(0, 30)}`));

  async function adellAllDay(page) {
    await openGuardies(page);
    await uploadConfiguration(page);
    await page.locator('#professor-search').fill('ADELL');
    await page.locator('#professor-results [data-professor]').first().click();
    await page.locator('#add-all-hours').click();
    await expect(page.locator('#coverage-list [data-assignacio]').first()).toBeVisible();
  }

  test('el professorat veu l’hora en curs destacada i no hi queden seccions buides', async ({ page }) => {
    await startAt(page, '2026-09-07T08:30:00+02:00');
    await adellAllDay(page);
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.goto('/?data=2026-09-07&vista=professor');

    const current = page.locator('#coverage-list .coverage-session.is-current');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('1a hora');
    await expect(current.locator('.now-badge')).toHaveText('Ara');
    await expect(page.locator('#coverage-list .coverage-session').filter({ hasText: '2a hora' }).locator('.session-pending')).toHaveText('1 sense cobrir');
    // L'etiqueta diu qui es fa càrrec, sense cap G al costat del nom.
    await expect(page.locator('.public-row .status-label').first()).toHaveText('Queden amb el seu grup');
    // Sense zones de pati ni grups de sortida no queda cap capsa buida.
    await expect(page.locator('#coverage-list .pati-session')).toHaveCount(0);
    await expect(page.locator('#outings-line .outings-line')).toHaveCount(0);
    expect(await tinyTexts(page)).toEqual([]);
  });

  test('el professorat veu a dalt les guàrdies que li toquen, marcades amb «Tu»', async ({ page }) => {
    await startAt(page, '2026-09-07T08:30:00+02:00');
    await adellAllDay(page);
    // A les 8:55 cobreix la Clara Sanz, que és de guàrdia en aquella hora.
    const second = page.locator('#coverage-list .coverage-session').filter({ hasText: '2a hora' }).locator('[data-assignacio]');
    await second.selectOption('3');
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.goto('/?data=2026-09-07&vista=professor');
    await expect(page.locator('.public-row').first()).toBeVisible();
    await page.evaluate(async () => {
      const { useGuardiesStore } = await import('/labs/guardies/stores/guardies.js');
      useGuardiesStore().viewerName = 'Clara Sanz Vidal';
      window.dispatchEvent(new CustomEvent('guardies:legacy-render'));
    });

    const summary = page.locator('.my-guards');
    await expect(summary).toContainText('Avui et toca');
    await expect(summary.locator('.my-guard')).toHaveCount(1);
    await expect(summary.locator('.my-guard')).toContainText('2a hora');
    await expect(summary.locator('.my-guard')).toContainText('1ESO-A · Aula 14');
    const mine = page.locator('.public-row.is-mine');
    await expect(mine).toHaveCount(1);
    await expect(mine.locator('.mine-chip')).toHaveText('Tu');
    await expect(mine).toContainText('Sanz Vidal, Clara');
  });

  test('en mòbil, el dia d’avui s’obre a l’hora en curs', async ({ page }) => {
    await startAt(page, '2026-09-07T09:00:00+02:00');
    await adellAllDay(page);
    await page.getByRole('button', { name: 'Publica' }).click();
    await expect(page.locator('#day-status-action')).toHaveText('Tanca jornada');
    await page.setViewportSize({ width: 390, height: 700 });
    // L'horari de prova és curt: espai a sota perquè l'hora en curs pugui pujar fins a dalt.
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#coverage-list { padding-bottom: 1600px !important; }';
      document.head.append(style);
    }));
    await page.goto('/?data=2026-09-07&vista=professor');
    const current = page.locator('#coverage-list .coverage-session.is-current');
    await expect(current).toContainText('2a hora');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const position = await current.evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      nav: document.querySelector('.app-nav').getBoundingClientRect().height,
    }));
    // Queda just a sota de la barra superior.
    expect(position.top).toBeGreaterThanOrEqual(position.nav);
    expect(position.top).toBeLessThan(position.nav + 40);
  });

  test('a la gestió, cada fila és més baixa: el codi va a part i la matèria i l’aula en una línia', async ({ page }) => {
    await adellAllDay(page);
    const row = page.locator('#coverage-list [data-coverage-row]').first();
    await expect(row.locator('.teacher-code')).toHaveText('ADEL');
    await expect(row.locator('.coverage-professor-cell strong.no-print')).toContainText('Adell Domènech, Marina');
    await expect(row.locator('.coverage-detail-line')).toHaveText('MAT · Aula 14');
    await expect(row.locator('.coverage-detail-line .coverage-room-label')).toHaveText('Aula 14');
  });

  test('un sol botó principal, la × al final de la fila i cap text per sota de 12 px', async ({ page }, testInfo) => {
    await adellAllDay(page);
    await expect(page.locator('#auto-assign-guards')).toHaveClass(/ghost/);
    await expect(page.getByRole('button', { name: 'Aplica interval' })).toHaveClass(/ghost/);
    expect(await tinyTexts(page)).toEqual([]);

    if (testInfo.project.name === 'chromium-desktop') {
      const row = await page.locator('#coverage-list [data-coverage-row]').first().boundingBox();
      const remove = await page.locator('#coverage-list [data-coverage-row]').first().locator('.icon-remove').boundingBox();
      expect(row.x + row.width - (remove.x + remove.width)).toBeLessThan(20);
    }

    await page.getByRole('tab', { name: 'Estadístiques' }).click();
    await expect(page.locator('[data-ranking-most] li').first().locator('.ranking-bar')).toHaveCount(1);
    expect(await tinyTexts(page)).toEqual([]);

    await page.getByRole('tab', { name: 'Configuració' }).click();
    await page.locator('details.admin-panel').evaluateAll((panels) => panels.forEach((panel) => { panel.open = true; }));
    await page.waitForTimeout(500);
    expect(await tinyTexts(page)).toEqual([]);
  });
});
