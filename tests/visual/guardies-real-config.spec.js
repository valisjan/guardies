import { expect, test } from '@playwright/test';

const reference = process.env.GUARDIES_REFERENCE_FILE;
const teachers = process.env.GUARDIES_GPU004_FILE;
const duties = process.env.GUARDIES_GPU001_FILE;
const configured = [reference, teachers, duties].every(Boolean);

test('valida una configuració real del centre', async ({ page }) => {
  test.skip(!configured, 'Defineix les tres rutes GUARDIES_* per executar aquesta validació local.');
  await page.goto('/');
  await page.locator('#reference-file').setInputFiles(reference);
  await expect(page.locator('[data-upload-status="reference"]')).toHaveText('OK');
  await page.locator('#untis-file').setInputFiles(teachers);
  await expect(page.locator('[data-upload-status="untis"]')).toHaveText('OK');
  await page.locator('#duties-file').setInputFiles(duties);
  await expect(page.locator('[data-upload-status="duties"]')).toHaveText('OK');
  await expect(page.locator('#workspace')).toBeVisible();
  expect(Number(await page.locator('#stat-sessions').innerText())).toBeGreaterThan(100);
  expect(Number(await page.locator('#stat-professors').innerText())).toBeGreaterThan(20);
  await expect(page.locator('#professor-search')).toBeEnabled();
  await expect(page.locator('#error-box')).toBeHidden();
  await page.locator('#professor-search').fill('ADELL');
  await expect(page.locator('#professor-results')).toContainText('ADELL DOMENECH, MARINA');
  await page.locator('#date-input').fill('2026-09-07');
  await page.locator('#date-input').press('Tab');
  await expect(page.locator('#coverage-list .coverage-session')).toHaveCount(8);
  await expect(page.locator('#coverage-list .coverage-session').nth(3)).toContainText('Pati');
});
