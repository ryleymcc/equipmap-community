const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = __dirname;
  const shared = process.argv.includes('--shared');
  const fixture = JSON.parse(fs.readFileSync(path.join(root, shared ? 'test-results/shared-smoke.json' : 'test-results/smoke.json')));
  const password = fs.readFileSync(path.join(fixture.data, 'initial-password.txt'), 'utf8').trim();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const report = { externalRequests: [], consoleErrors: [], pageErrors: [], checks: [] };
  // Simulate disconnected Windows adapters while preserving loopback HTTP.
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.url) {
      report.externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  async function screenshot(name) {
    await page.screenshot({ path: path.join(root, `test-results/${name}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflows horizontally`);
  }
  function pass(name) { report.checks.push(name); console.log('PASS', name); }
  try {
    await page.goto(fixture.url + '/login');
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(fixture.url + '/');
    await page.getByText('Offline PDF', { exact: true }).waitFor();
    assert.equal(await page.locator('.offline-banner').count(), 0);
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.fonts.check('14px Outfit')));
    await screenshot('desktop-dashboard');
    pass('browser login, local font and editable UI with navigator.onLine false');
    await page.getByTitle('Options', { exact: true }).click();
    await page.getByRole('button', { name: 'Rescale Floorplan' }).click();
    await page.locator('.rescale-preview canvas').first().waitFor({ timeout: 30000 });
    await screenshot('desktop-rescale');
    await page.getByLabel('Horizontal (px)').focus();
    assert(await page.getByLabel('Horizontal (px)').evaluate(element => element === document.activeElement));
    await page.keyboard.press('Tab');
    pass('rescale PDF worker renders locally and controls accept keyboard focus');
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('narrow-rescale');
    // Modal closes via its explicit control; no scale changes are applied.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await screenshot('narrow-dashboard');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.card').filter({ hasText: 'Offline PDF' }).click();
    await page.waitForURL('**/map/*');
    await page.locator('.floorplan-tiles canvas').first().waitFor({ timeout: 30000 });
    await screenshot('desktop-map');
    pass('PDF map renders from bundled worker without internet');
    await page.goto(`${fixture.url}/map/${fixture.floorplan_id}?highlightType=equipment&highlightId=${fixture.equipment_id}`);
    await page.waitForFunction(() => document.querySelector('input[placeholder="Search"]')?.value === 'AHU-Portable');
    await page.waitForTimeout(1200); // Wait for the native 500ms map zoom animation.
    await page.mouse.click(720, 500);
    await page.locator('input[name="name"]').waitFor();
    await page.locator('textarea[name="description"]').fill('Edited through offline browser');
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/equipment/${fixture.equipment_id}`) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.mouse.click(720, 500);
    await page.getByRole('button', { name: 'Documents & manuals' }).click();
    await page.getByText('AHU manual.pdf', { exact: true }).waitFor();
    assert.equal(await page.locator('#equipment-document-file').isEnabled(), true);
    await screenshot('desktop-documents');
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('narrow-documents');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await screenshot('narrow-map');
    pass('offline equipment edit and document dialog on desktop and narrow screens');
    assert.equal(report.externalRequests.length, 0, JSON.stringify(report.externalRequests));
    assert.equal(report.pageErrors.length, 0, JSON.stringify(report.pageErrors));
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
    pass('no external app requests or browser console/page errors');
  } finally {
    await page.screenshot({ path: path.join(root, 'test-results/browser-last.png'), fullPage: true });
    fs.writeFileSync(path.join(root, shared ? 'test-results/shared-browser.json' : 'test-results/browser.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
