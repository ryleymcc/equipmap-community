import * as Sentry from '@sentry/react';
import { sanitizeDiagnostics } from './diagnosticPrivacy.js';

let deviceHints = {};
const reported = new WeakMap();

export async function initializeDeviceDiagnostics() {
  try {
    deviceHints = await navigator.userAgentData?.getHighEntropyValues([
      'model', 'platformVersion', 'fullVersionList', 'architecture', 'bitness',
    ]) || {};
    Sentry.setContext('device_hints', deviceHints);
  } catch { /* Browser privacy policy can withhold model/version hints. */ }
}

export function runtimeDiagnostics(includeResources = true) {
  const connection = navigator.connection;
  const controller = navigator.serviceWorker?.controller;
  return {
    user_agent: navigator.userAgent,
    ...deviceHints,
    platform: navigator.userAgentData?.platform || navigator.platform,
    mobile: navigator.userAgentData?.mobile,
    memory_gb: navigator.deviceMemory,
    logical_cores: navigator.hardwareConcurrency,
    max_touch_points: navigator.maxTouchPoints,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    pixel_ratio: window.devicePixelRatio,
    online: navigator.onLine,
    connection_type: connection?.effectiveType,
    downlink_mbps: connection?.downlink,
    rtt_ms: connection?.rtt,
    save_data: connection?.saveData,
    visibility: document.visibilityState,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    route: window.location.pathname,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone || false,
    service_worker_url: controller?.scriptURL,
    service_worker_state: controller?.state,
    recent_resources: includeResources ? performance.getEntriesByType('resource').slice(-12).map(entry => ({
      url: entry.name.split(/[?#]/)[0], duration_ms: Math.round(entry.duration),
      transfer_bytes: entry.transferSize, response_status: entry.responseStatus,
      initiator: entry.initiatorType,
    })) : undefined,
    capabilities: {
      worker: typeof Worker !== 'undefined', offscreen_canvas: typeof OffscreenCanvas !== 'undefined',
      image_bitmap: typeof createImageBitmap !== 'undefined', web_locks: Boolean(navigator.locks),
    },
  };
}

export function diagnosticBreadcrumb(message, details = {}) {
  Sentry.addBreadcrumb({ category: 'equipmap', message, data: sanitizeDiagnostics(details), level: 'info' });
}

export function captureDiagnostic(error, operation, details = {}, level = 'error') {
  if (error?.name === 'AbortError' || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
  if (error && typeof error === 'object') {
    const operations = reported.get(error) || new Set();
    if (operations.has(operation)) return;
    operations.add(operation);
    reported.set(error, operations);
  }
  Sentry.withScope(scope => {
    scope.setTag('operation', operation);
    if (details.stage) scope.setTag('failure_stage', details.stage);
    scope.setLevel(level);
    scope.setContext('runtime', sanitizeDiagnostics(runtimeDiagnostics()));
    scope.setContext('operation', sanitizeDiagnostics(details));
    // Preserve original exception stack, but never attach Axios config/payloads.
    const exception = new Error(error?.message || String(error || operation));
    exception.name = error?.name || 'Error';
    if (error?.stack) exception.stack = error.stack;
    Sentry.captureException(exception);
  });
}

export function captureApiFailure(error) {
  const status = error.response?.status;
  // Expected validation/permission/auth failures stay with their normal UI flow.
  if (status && status < 500) return;
  const config = error.config || {};
  captureDiagnostic(error, 'api.request', {
    method: config.method?.toUpperCase(),
    url: config.url?.split(/[?#]/)[0],
    status: status || 0, code: error.code,
    elapsed_ms: config.metadata?.startTime ? Math.round(performance.now() - config.metadata.startTime) : undefined,
    timeout_ms: config.timeout,
  }, navigator.onLine ? 'error' : 'warning');
}
