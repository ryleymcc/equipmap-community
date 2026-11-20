import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDiagnostics } from '../src/diagnosticPrivacy.js';

test('redacts nested Axios credentials including JSON inside console messages', () => {
  const payload = { config: { headers: { Authorization: 'Bearer secret-value' },
    data: JSON.stringify({ refresh_token: 'refresh-value', password: 'password-value' }),
    url: 'https://example.test/api/refresh-token?token=query-value',
  } };
  const result = JSON.stringify(sanitizeDiagnostics({
    extra: payload, message: `Refresh failed: ${JSON.stringify(payload)}`,
    user: { email: 'person@example.test' },
  }));
  for (const value of ['secret-value', 'refresh-value', 'password-value', 'query-value', 'person@example.test']) {
    assert.ok(!result.includes(value), `must remove ${value}`);
  }
  assert.ok(result.includes('/api/refresh-token'));
});

test('preserves actionable error, device, HTTP and floorplan context', () => {
  const context = { stage: 'pdf.document', floorplan_id: 2, status: 403,
    device: { model: 'SM-A155', memory_gb: 4, viewport_width: 390 },
    exception: { values: [{ type: 'TypeError', value: 'Failed to fetch dynamically imported module',
      stacktrace: { frames: [{ filename: 'https://example.test/assets/pdf.worker.mjs', lineno: 5 }] } }] },
  };
  assert.deepEqual(sanitizeDiagnostics(context), context);
});

test('does not mutate SDK payloads and bounds cyclic objects', () => {
  const input = { password: 'private', data: { value: 42 } };
  const output = sanitizeDiagnostics(input);
  assert.equal(input.password, 'private');
  assert.equal(output.password, '[REDACTED]');
  const cycle = {}; cycle.self = cycle;
  assert.doesNotThrow(() => sanitizeDiagnostics(cycle));
});
