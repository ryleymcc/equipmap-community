import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectDashboardSite } from '../src/dashboardSite.js';

const sites = [{ id: 4 }, { id: 9 }];

test('fresh login with no saved selection selects the first accessible site', () => {
  assert.equal(selectDashboardSite(sites, null, undefined), sites[0]);
});

test('explicit or remembered site takes priority over the cached active site', () => {
  assert.equal(selectDashboardSite(sites, '9', 4), sites[1]);
});

test('unavailable saved site falls back to a valid active site', () => {
  assert.equal(selectDashboardSite(sites, '999', 9), sites[1]);
});

test('stale saved and active sites fall back to the first accessible site', () => {
  assert.equal(selectDashboardSite(sites, '999', 888), sites[0]);
});

test('accounts with no accessible sites have no active site', () => {
  assert.equal(selectDashboardSite([], '9', 4), null);
});
