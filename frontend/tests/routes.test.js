import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('App.jsx defines /floorplans route mapped to Dashboard', () => {
  const appFile = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.match(
    appFile,
    /<Route\s+path="\/floorplans"\s+element=\{<Dashboard\s*\/>\}\s*\/>/,
    '/floorplans route must be mapped to Dashboard'
  );
});

test('DashboardLeftDrawer navigates to /floorplans when clicking floorplans', () => {
  const drawerFile = fs.readFileSync(path.join(__dirname, '../src/components/DashboardLeftDrawer.jsx'), 'utf8');
  assert.match(
    drawerFile,
    /if\s*\(\s*view === 'floorplans'\s*\)\s*\{\s*navigate\('\/floorplans'\);/
  );
});

test('useDashboard handleNavClick navigates to /floorplans when view is floorplans', () => {
  const hookFile = fs.readFileSync(path.join(__dirname, '../src/hooks/useDashboard.js'), 'utf8');
  assert.match(
    hookFile,
    /else if\s*\(\s*view === 'floorplans'\s*\)\s*\{\s*navigate\('\/floorplans'\);/
  );
});

test('useDashboard syncs activeView to floorplans on /floorplans route', () => {
  const hookFile = fs.readFileSync(path.join(__dirname, '../src/hooks/useDashboard.js'), 'utf8');
  assert.match(
    hookFile,
    /else if\s*\(location\.pathname === '\/' \|\| location\.pathname === '\/floorplans'\)\s*setActiveView\('floorplans'\);/
  );
});

test('LeftDrawer defines backLabel for /floorplans', () => {
  const leftDrawerFile = fs.readFileSync(path.join(__dirname, '../src/components/LeftDrawer.jsx'), 'utf8');
  assert.match(
    leftDrawerFile,
    /'\/floorplans':\s*'Floorplans'/
  );
});
