// Run against: python backend/tests/drawing_browser_fixture.py (after npm run build).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DRAWING_TEST_URL || 'http://127.0.0.1:8768';
const sheet = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200"><path d="M400 200H1400V700H1700M700 200V450" fill="none" stroke="#2648aa" stroke-width="12"/></svg>');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('token', 'isolated-drawing-fixture'));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('status of 503')) errors.push(message.text()); });
    let failListOnce = true;
    await page.route('**/api/floorplans/1/drawings', route => {
      if (route.request().method() === 'GET' && failListOnce) { failListOnce = false; return route.fulfill({ status: 503, json: { detail: 'Drawing list temporarily unavailable.' } }); }
      return route.continue();
    });
    fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
    await page.goto(base + '/?siteId=1');
    await page.locator('.card-grid > .card').filter({ hasText: 'Level 2' }).click();
    const panel = page.getByRole('region', { name: 'Drawing layers', exact: true });
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    await panel.getByRole('button', { name: 'Retry', exact: true }).click();
    await panel.getByText('No drawings for this floor.', { exact: true }).waitFor();
    const disciplineFilter = panel.getByLabel('Discipline', { exact: true });
    assert.equal(await disciplineFilter.count(), 0);
    for (const [title, number] of [['West HVAC', 'M-101'], ['Clinic renovation', 'M-204']]) {
      await panel.getByRole('button', { name: 'Upload drawing', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Upload drawing', exact: true });
      assert.deepEqual(await dialog.locator('datalist option').evaluateAll(options => options.map(option => option.value)),
        ['Mechanical / HVAC', 'Plumbing', 'Electrical', 'Other']);
      await dialog.getByLabel('Drawing file', { exact: true }).setInputFiles({ name: number + '.svg', mimeType: 'image/svg+xml', buffer: sheet });
      await dialog.getByLabel('Title', { exact: true }).fill(title);
      await dialog.getByLabel('Drawing number', { exact: true }).fill(number);
      await dialog.getByLabel('Project / area', { exact: true }).fill('East wing');
      await dialog.getByLabel('Drawing date', { exact: true }).fill('2025-02-01');
      await dialog.getByRole('button', { name: 'Upload drawing', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
      await panel.getByRole('button', { name: 'Use whole floor', exact: true }).click();
      await panel.getByLabel('Scale (%)', { exact: true }).fill('75');
      await panel.getByLabel('Rotation (°)', { exact: true }).fill('5');
      await panel.getByRole('button', { name: 'Save placement', exact: true }).click();
      await panel.getByRole('button', { name: 'Align & coverage', exact: true }).waitFor();
    }
    await panel.getByLabel('Compare with', { exact: true }).selectOption({ label: 'M-101 · 2025-02-01' });
    assert.equal(await page.locator('.drawing-map-sheet').count(), 2);
    await panel.getByLabel(/Drawing opacity/).fill('40');
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [644, 460]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250); // Let existing drawer viewport transitions settle.
      await panel.getByRole('button', { name: 'Show coverage', exact: true }).click();
      await page.screenshot({ path: path.join(__dirname, `../test-results/drawing-layers-${width}.png`) });
      const bounds = await panel.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const outliers = await panel.evaluate(element => { const b = element.getBoundingClientRect(); return [...element.querySelectorAll('input, select, button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < b.left - 1 || r.right > b.right + 1); }).map(e => e.outerHTML); });
      assert.deepEqual(outliers, []);
      await panel.getByRole('button', { name: 'Upload drawing', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Upload drawing', exact: true });
      await dialog.getByLabel('Title', { exact: true }).fill('Keyboard test');
      await page.keyboard.press('Tab');
      const discipline = dialog.getByLabel('Discipline', { exact: true });
      assert(await discipline.evaluate(element => element === document.activeElement));
      assert.equal(await discipline.inputValue(), 'Mechanical / HVAC');
      await discipline.fill('   ');
      assert(await discipline.evaluate(element => !element.validity.valid));
      await discipline.fill('Fire Protection');
      const fieldBounds = await discipline.boundingBox();
      const dialogBounds = await dialog.boundingBox();
      assert(fieldBounds.x >= dialogBounds.x && fieldBounds.x + fieldBounds.width <= dialogBounds.x + dialogBounds.width);
      if (width < 700) assert(fieldBounds.height >= 44);
      await page.screenshot({ path: path.join(__dirname, `../test-results/drawing-upload-${width}.png`) });
      await page.keyboard.press('Escape');
      assert(await panel.getByRole('button', { name: 'Upload drawing', exact: true }).evaluate(e => document.activeElement === e));
      console.log(`${width}: layers, upload dialog, responsive bounds, and focus return passed`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    await panel.getByLabel('Compare with', { exact: true }).selectOption('');
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
    await panel.getByRole('button', { name: 'Collapse drawing controls', exact: true }).click();
    assert.equal(await page.locator('.drawing-region-coverage .drawing-region-handle').count(), 0);
    await panel.getByRole('heading', { name: 'Move drawing', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Expand drawing controls', exact: true }).click();
    await panel.getByRole('button', { name: 'Coverage points', exact: true }).click();
    const coveragePoint = page.getByRole('button', { name: 'Coverage top left point', exact: true });
    const beforePan = await page.locator('.map-content').boundingBox();
    const coordinateBeforePan = await panel.getByLabel('Coverage X1 (%)', { exact: true }).inputValue();
    await page.mouse.move(100, 200); await page.mouse.down(); await page.mouse.move(140, 220, { steps: 5 }); await page.mouse.up();
    const afterPan = await page.locator('.map-content').boundingBox();
    assert(Math.abs(afterPan.x - beforePan.x - 40) < 2 && Math.abs(afterPan.y - beforePan.y - 20) < 2);
    assert.equal(await panel.getByLabel('Coverage X1 (%)', { exact: true }).inputValue(), coordinateBeforePan);
    const coverageBounds = await coveragePoint.boundingBox();
    await page.mouse.move(coverageBounds.x + coverageBounds.width / 2, coverageBounds.y + coverageBounds.height / 2);
    await page.mouse.down(); await page.mouse.move(coverageBounds.x + coverageBounds.width / 2 + 35, coverageBounds.y + coverageBounds.height / 2 + 25, { steps: 4 }); await page.mouse.up();
    assert(Number(await panel.getByLabel('Coverage X1 (%)', { exact: true }).inputValue()) > 0);
    assert(Number(await panel.getByLabel('Coverage Y1 (%)', { exact: true }).inputValue()) > 0);
    await coveragePoint.press('ArrowRight');
    await panel.getByRole('button', { name: 'Save placement', exact: true }).click();
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
    await panel.getByRole('button', { name: 'Coverage points', exact: true }).click();
    await panel.getByLabel('Coverage X1 (%)', { exact: true }).fill('15');
    await panel.getByRole('button', { name: 'Crop points', exact: true }).click();
    const cropPoint = page.getByRole('button', { name: 'Crop bottom right point', exact: true });
    const cropBounds = await cropPoint.boundingBox();
    await page.mouse.move(cropBounds.x + cropBounds.width / 2, cropBounds.y + cropBounds.height / 2);
    await page.mouse.down(); await page.mouse.move(cropBounds.x + cropBounds.width / 2 - 35, cropBounds.y + cropBounds.height / 2 - 25, { steps: 4 }); await page.mouse.up();
    assert(Number(await panel.getByLabel('Crop right (%)', { exact: true }).inputValue()) > 0);
    assert(Number(await panel.getByLabel('Crop bottom (%)', { exact: true }).inputValue()) > 0);
    await cropPoint.press('ArrowLeft');
    const bottomBeforeEdge = await panel.getByLabel('Crop bottom (%)', { exact: true }).inputValue();
    const rightBeforeEdge = Number(await panel.getByLabel('Crop right (%)', { exact: true }).inputValue());
    await page.getByRole('button', { name: 'Crop right edge point', exact: true }).press('ArrowLeft');
    assert(Number(await panel.getByLabel('Crop right (%)', { exact: true }).inputValue()) > rightBeforeEdge);
    assert.equal(await panel.getByLabel('Crop bottom (%)', { exact: true }).inputValue(), bottomBeforeEdge);
    await panel.getByLabel('Crop left (%)', { exact: true }).fill('5');
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [644, 460]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
      await panel.getByRole('button', { name: 'Show crop', exact: true }).click();
      if (height < 600) { await panel.getByRole('button', { name: 'Expand drawing controls', exact: true }).waitFor(); await page.waitForTimeout(50); }
      const handles = page.locator('.drawing-region-crop .drawing-region-handle');
      assert.equal(await handles.count(), 8);
      for (const handle of await handles.all()) { const bounds = await handle.boundingBox(); assert(Math.abs(bounds.width - 44) < 1 && Math.abs(bounds.height - 44) < 1); assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1); }
      const points = await Promise.all((await handles.all()).map(handle => handle.boundingBox()));
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j]; assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Corner hit targets must not overlap');
      }
      await page.screenshot({ path: path.join(__dirname, `../test-results/drawing-crop-points-${width}.png`) });
      console.log(`${width}: four visible crop handles keep 44px hit targets after rotation/scale/zoom`);
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
    if (await panel.getByRole('button', { name: 'Expand drawing controls', exact: true }).isVisible()) await panel.getByRole('button', { name: 'Expand drawing controls', exact: true }).click();
    await panel.getByLabel('Crop top (%)', { exact: true }).fill('10');
    await panel.getByLabel('Crop right (%)', { exact: true }).fill('15');
    await panel.getByLabel('Crop bottom (%)', { exact: true }).fill('20');
    await panel.getByLabel('Crop left (%)', { exact: true }).fill('0');
    assert.equal(await panel.getByLabel('Crop right (%)', { exact: true }).inputValue(), '15');
    await panel.getByLabel('Crop left (%)', { exact: true }).fill('5');
    await panel.getByRole('button', { name: 'Save placement', exact: true }).click();
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).waitFor();
    const savedDrawings = await (await page.request.get(base + '/api/floorplans/1/drawings')).json();
    assert.deepEqual(savedDrawings.find(item => item.title === 'Clinic renovation').placement.crop, { x: 5, y: 10, width: 80, height: 70 });
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
    await panel.getByText('Crop drawing margins', { exact: true }).click();
    assert.equal(await panel.getByLabel('Crop right (%)', { exact: true }).inputValue(), '15');
    assert.equal(await panel.getByLabel('Crop bottom (%)', { exact: true }).inputValue(), '20');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await panel.getByRole('button', { name: 'Floorplan only', exact: true }).click();
    assert.equal(await page.locator('.drawing-map-sheet').count(), 0);
    assert.deepEqual(await disciplineFilter.locator('option').evaluateAll(options => options.map(option => option.value)), ['hvac']);
    await panel.getByRole('button', { name: 'Upload drawing', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Upload drawing', exact: true });
    await upload.getByLabel('Drawing file', { exact: true }).setInputFiles({ name: 'Fire plan.svg', mimeType: 'image/svg+xml', buffer: sheet });
    await upload.getByLabel('Discipline', { exact: true }).fill('Fire Protection');
    await upload.getByRole('button', { name: 'Upload drawing', exact: true }).click();
    await upload.waitFor({ state: 'hidden' });
    assert.equal(await disciplineFilter.inputValue(), 'Fire Protection');

    await panel.getByRole('button', { name: 'Edit details', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit drawing details', exact: true });
    const editDiscipline = edit.getByLabel('Discipline', { exact: true });
    assert.equal(await editDiscipline.inputValue(), 'Fire Protection');
    assert.equal(await edit.locator('datalist option[value="Fire Protection"]').count(), 1);
    await editDiscipline.fill('Plumbing');
    await edit.getByRole('button', { name: 'Save details', exact: true }).press('Enter');
    await edit.waitFor({ state: 'hidden' });
    assert.equal(await disciplineFilter.inputValue(), 'plumbing');
    assert.equal(await disciplineFilter.locator('option[value="Fire Protection"]').count(), 0);
    await panel.getByRole('button', { name: 'Remove drawing', exact: true }).click();
    await panel.locator('.drawing-delete-confirm').getByRole('button', { name: 'Remove drawing', exact: true }).click();
    await disciplineFilter.locator('option[value="plumbing"]').waitFor({ state: 'detached' });
    assert.equal(await disciplineFilter.inputValue(), 'hvac');
    assert.deepEqual(errors, []);
    console.log('Discipline suggestions, filter visibility, edit, and removal passed');

    for (const [filename, pageNumber] of [['pages.pdf', '2'], ['image.png', '1']]) {
      const contents = await (await page.request.get(base + '/uploads/' + filename)).body();
      await panel.getByRole('button', { name: 'Upload drawing', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Upload drawing', exact: true });
      await dialog.getByLabel('Drawing file', { exact: true }).setInputFiles({ name: filename, mimeType: filename.endsWith('.pdf') ? 'application/pdf' : 'image/png', buffer: contents });
      await dialog.getByLabel('Title', { exact: true }).fill(filename);
      await dialog.getByLabel('PDF page', { exact: true }).fill(pageNumber);
      await dialog.getByRole('button', { name: 'Upload drawing', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
      await panel.getByRole('button', { name: 'Use whole floor', exact: true }).click();
      await panel.getByRole('button', { name: 'Save placement', exact: true }).click();
      await panel.getByRole('button', { name: 'Align & coverage', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.drawing-map-sheet canvas')?.width > 0);
      await page.waitForFunction(() => ![...document.querySelectorAll('.drawing-map-status')].some(e => e.textContent.includes('Loading')));
    }
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).click();
    await panel.getByRole('button', { name: 'Match points', exact: true }).click();
    const pointPairs = [[15, 15, 12, 16], [85, 15, 82, 20], [85, 85, 86, 84], [15, 85, 14, 79], [50, 50, 52, 48]];
    for (const [sx, sy, tx, ty] of pointPairs) {
      const sheetBounds = await page.locator('.drawing-map-sheet').boundingBox();
      await page.mouse.click(sheetBounds.x + sheetBounds.width * sx / 100, sheetBounds.y + sheetBounds.height * sy / 100);
      await panel.getByText(/pick the same landmark on the floorplan/).waitFor();
      const floorBounds = await page.locator('.map-content').boundingBox();
      await page.mouse.click(floorBounds.x + floorBounds.width * tx / 100, floorBounds.y + floorBounds.height * ty / 100);
    }
    await panel.getByText(/5 matched pairs/).waitFor();
    await panel.getByRole('button', { name: 'Preview warp', exact: true }).click();
    const warped = page.getByRole('img', { name: 'Warped drawing: image.png' });
    await warped.waitFor();
    const overview = warped.locator('.drawing-match-overview');
    assert(await overview.evaluate(canvas => canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3] > 0));
    await page.locator('.drawing-match-output[data-detail="ready"]').waitFor();
    await page.mouse.move(400, 400);
    for (let notch = 0; notch < 6; notch++) {
      await page.mouse.wheel(0, -160);
    }
    await page.locator('.drawing-match-output[data-detail="preview"]').waitFor();
    await page.locator('.drawing-match-output[data-detail="ready"]').waitFor();
    const detail = warped.locator('.drawing-match-detail');
    const [overviewDensity, detailDensity] = await Promise.all([overview, detail].map(canvas => canvas.evaluate(node => node.width / node.getBoundingClientRect().width)));
    assert(detailDensity > overviewDensity, 'Zoomed viewport should render at a higher pixel density than the overview');
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await panel.getByRole('button', { name: 'Fit floorplan', exact: true }).click();
      const bounds = await panel.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
      await page.screenshot({ path: path.join(__dirname, `../test-results/drawing-match-${width}.png`) });
    }
    await panel.getByRole('button', { name: 'Save placement', exact: true }).click();
    await panel.getByRole('button', { name: 'Align & coverage', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await panel.getByRole('button', { name: /image\.png/ }).click();
    await warped.waitFor();
    const savedImage = (await (await page.request.get(base + '/api/floorplans/1/drawings')).json()).find(item => item.title === 'image.png');
    assert.equal(savedImage.placement.matches.length, 5);
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel.getByRole('button', { name: 'Show coverage', exact: true }).click();
    const mapBounds = await page.locator('.map-content').boundingBox();
    await page.mouse.click(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
    await page.locator('.drawer-right.drawer-open').waitFor();
    assert(await panel.isHidden());
    await page.getByTitle('Hide Drawer', { exact: true }).click();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await panel.waitFor();
    await panel.getByRole('button', { name: 'Close drawing layers', exact: true }).focus();
    await page.keyboard.press('Escape');
    assert(await page.getByRole('button', { name: 'Layers', exact: true }).evaluate(e => document.activeElement === e));
    await page.request.post(base + '/fixture/replace-base');
    await page.reload();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await panel.getByText('Alignment needs review', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.drawing-map-sheet').count(), 0);
    await panel.getByRole('button', { name: 'Close drawing layers', exact: true }).click();
    await page.getByRole('button', { name: 'Open Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
    await page.getByText('Level 2', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('Level 2', { exact: true }).waitFor();
    assert(await page.getByText('Something went wrong.', { exact: true }).isHidden());
    assert.deepEqual(errors, []);
    console.log('Real upload/save API, coverage/crop point dragging, keyboard coordinates, persistence, comparison, empty state, base-replacement review, and console checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
