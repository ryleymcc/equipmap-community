/* global require, __dirname, process, Buffer */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = fs.readdirSync(path.join(root, 'dist/assets'));
const worker = assets.find(name => /^pdf\.worker.*\.js$/.test(name));
assert.ok(worker, 'PDF worker must have a fresh .js URL');
const oldWorker = `/assets/${worker.replace(/\.js$/, '.mjs')}`;
const workerBody = fs.readFileSync(path.join(root, 'dist/assets', worker));
assert.ok(fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8').includes(worker), 'new worker must be precached');
const floorplans = [1, 2].map(id => ({ id, site_id: 1, name: id === 1 ? 'Cached PDF' : 'Broken PDF',
  file_type: 'pdf', file_path: `/uploads/fixture-${id}.pdf`, rooms: [], equipment: [], tickets: [], reference_points: [] }));
const origin = 'http://127.0.0.1:4191';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, origin).pathname;
  const send = (body, type = 'application/json', status = 200) => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }); res.end(body);
  };
  if (pathname === '/seed.html') return send('<!doctype html><title>Legacy cache fixture</title>', 'text/html');
  if (pathname === '/legacy-sw.js') return send(`self.addEventListener('install',()=>self.skipWaiting());
    self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname===${JSON.stringify(oldWorker)})
      e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});`, 'application/javascript');
  if (pathname === oldWorker) return send(workerBody, 'application/octet-stream');
  if (pathname.startsWith('/uploads/fixture-')) return send(pathname.includes('-2.') ? '%PDF-1.7 invalid'
    : fs.readFileSync(path.join(root, 'test-results/map-fixtures/vector.pdf')), 'application/pdf');
  if (pathname.startsWith('/api/')) {
    let value = [];
    if (pathname === '/api/users/me') value = { id: 1, username: 'fixture', role: 'viewer', can_manage_items: false };
    else if (pathname === '/api/sites') value = [{ id: 1, name: 'Test site' }];
    else if (pathname === '/api/sites/1/floorplans') value = floorplans;
    else if (/^\/api\/floorplans\/\d+$/.test(pathname)) value = floorplans[Number(pathname.split('/').pop()) - 1];
    else if (pathname === '/api/sync/check-updates') value = { urls_to_update: [] };
    return send(JSON.stringify(value));
  }
  const file = path.join(root, 'dist', pathname === '/' || !path.extname(pathname) ? 'index.html' : pathname);
  if (!file.startsWith(path.join(root, 'dist')) || !fs.existsSync(file)) return send('missing', 'text/plain', 404);
  const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
  send(fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
});

(async () => {
  await new Promise(resolve => server.listen(4191, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.route(/https:\/\//, route => route.fulfill({ status: 200, body: '{}' }));
      const page = await context.newPage();
      await page.goto(`${origin}/seed.html`);
      const legacy = await page.evaluate(async old => {
        localStorage.setItem('token', 'fixture-session');
        localStorage.setItem('lastActiveSiteId', '1');
        const cache = await caches.open('workbox-precache-v2-legacy');
        await cache.put(old, await fetch(old));
        await navigator.serviceWorker.register('/legacy-sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        try { await import(old); return 'unexpected success'; } catch { return 'MIME failure reproduced'; }
      }, oldWorker);
      assert.equal(legacy, 'MIME failure reproduced');
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${origin}/map/1`);
      await page.waitForSelector('.floorplan-tiles[data-detail="ready"] .floorplan-detail canvas');
      await page.waitForFunction(() => !document.querySelector('.map-loading-overlay'));
      await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
      // Start a clean app instance under the newly activated worker, just as
      // the deployed app does after consuming its deferred update.
      await page.reload();
      await page.waitForSelector('.floorplan-tiles[data-detail="ready"] .floorplan-detail canvas');
      await page.waitForFunction(() => !document.querySelector('.map-loading-overlay'));
      await page.getByTitle('Open Menu', { exact: true }).click();
      await page.getByText('Broken PDF', { exact: true }).click();
      await page.getByText('The floorplan drawing could not be loaded. Try again.', { exact: true }).waitFor();
      assert.equal(await page.getByText('Rendering blueprint canvas...', { exact: true }).count(), 0);
      const panel = page.locator('.map-loading-overlay').filter({ hasText: 'The floorplan drawing could not be loaded.' });
      const retry = panel.getByRole('button', { name: 'Retry', exact: true });
      // The outer error panel owns the accessible recovery actions.
      const back = panel.getByRole('button', { name: 'Back to Dashboard', exact: true });
      await back.focus(); await page.keyboard.press('Tab');
      assert.equal(await retry.last().evaluate(el => el === document.activeElement), true);
      assert.ok((await retry.boundingBox()).height >= 44);
      assert.ok((await back.boundingBox()).height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(root, `test-results/pdf-worker-error-${viewport.width}.png`) });
      await context.setOffline(true);
      await page.goBack();
      await page.waitForSelector('.floorplan-tiles[data-detail="ready"] .floorplan-detail canvas');
      await page.waitForFunction(() => !document.querySelector('.map-loading-overlay'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ viewport, legacy, newWorker: worker, errorRecovery: true, offlinePdf: true });
      await context.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
