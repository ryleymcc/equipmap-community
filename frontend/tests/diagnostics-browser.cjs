/* global require, __dirname, process */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const events = [];
      const unexpected = [];
      page.on('pageerror', error => unexpected.push(error.message));
      await page.route('**/uploads/memory-fixtures/**', route => {
        const file = path.join(__dirname, '../test-results/map-fixtures', path.basename(new URL(route.request().url()).pathname));
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' });
      });
      // Telemetry is inspected locally and never sent to the production project.
      await page.route('**/*sentry.io/**', route => route.fulfill({ status: 200, body: '{}' }));
      await page.route('**/api/diagnostics-test', route => route.fulfill({ status: 503, body: '{}' }));
      await page.goto('http://127.0.0.1:4189/tests/map-memory.html');
      await page.waitForFunction(() => window.mapTest?.loaded());
      await page.evaluate(async () => {
        const Sentry = await import('/node_modules/.vite/deps/@sentry_react.js');
        await import('/src/instrument.js');
        const options = Sentry.getClient().getOptions();
        const diagnostics = await import('/src/diagnostics.js');
        window.diagnosticEvents = [];
        Sentry.init({ ...options, integrations: [], dsn: 'https://public@example.test/1',
          transport: () => ({ send: async envelope => {
            for (const [header, payload] of envelope[1]) if (header.type === 'event') window.diagnosticEvents.push(payload);
            return { statusCode: 200 };
          }, flush: async () => true }),
        });
        await diagnostics.initializeDeviceDiagnostics();
        const cleanLog = options.beforeSendLog({ body: 'Refresh failed: ' + JSON.stringify({
          config: { data: JSON.stringify({ refresh_token: 'private-test-value' }) },
        }), attributes: {} });
        if (JSON.stringify(cleanLog).includes('private-test-value')) throw new Error('Log redaction failed');
        if (!cleanLog.attributes['device.user_agent']) throw new Error('Device log attributes missing');
        window.flushDiagnostics = () => Sentry.flush(2000);
      });
      for (const [index, stage] of [[11, 'pdf.document'], [12, 'image.decode']]) {
        await page.evaluate(i => window.mapTest.select(i), index);
        await page.getByText('Failed to load map image.', { exact: true }).waitFor();
        await page.waitForFunction(expected => window.diagnosticEvents.some(event => event.tags?.failure_stage === expected), stage);
        await page.evaluate(() => window.mapTest.select(0));
        await page.waitForFunction(() => window.mapTest.loaded());
      }
      await page.evaluate(async () => {
        const { api } = await import('/src/api.js');
        try { await api.get('/api/diagnostics-test'); } catch { /* expected injected 503 */ }
        await window.flushDiagnostics();
      });
      events.push(...await page.evaluate(() => window.diagnosticEvents));
      const pdf = events.find(event => event.tags?.failure_stage === 'pdf.document');
      assert.equal(pdf.contexts.operation.floorplan_id, 12);
      assert.ok(pdf.contexts.operation.worker_url.includes('pdf.worker'));
      assert.ok(pdf.contexts.operation.pdfjs_version);
      assert.equal(pdf.contexts.runtime.viewport_width, viewport.width);
      assert.ok(pdf.contexts.runtime.user_agent);
      assert.equal(typeof pdf.contexts.runtime.capabilities.offscreen_canvas, 'boolean');
      const image = events.find(event => event.tags?.failure_stage === 'image.decode');
      assert.ok(image.exception.values[0].value);
      const api = events.find(event => event.tags?.operation === 'api.request');
      assert.equal(api.contexts.operation.status, 503);
      assert.equal(api.contexts.operation.method, 'GET');
      assert.ok(!JSON.stringify(api).includes('Authorization'));
      await page.route('**/missing.pdf', () => { /* Deliberately leave the fetch pending. */ });
      await page.clock.install();
      const pendingRequest = page.waitForRequest('**/missing.pdf');
      await page.evaluate(() => window.mapTest.select(7));
      await page.waitForSelector('#floorplan-layer-8', { state: 'attached' });
      await pendingRequest;
      await page.clock.fastForward(45001);
      await page.waitForFunction(() => window.diagnosticEvents.some(event => event.tags?.operation === 'floorplan.stalled'));
      const stalled = await page.evaluate(() => window.diagnosticEvents.find(event => event.tags?.operation === 'floorplan.stalled'));
      assert.equal(stalled.level, 'warning');
      // A slow load is reported without turning it into a failed/cancelled load.
      assert.equal(await page.getByText('Failed to load map image.', { exact: true }).count(), 0);
      assert.deepEqual(unexpected, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      results.push({ viewport, stages: [...events, stalled].map(event => event.tags.failure_stage || event.tags.operation) });
      await context.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
