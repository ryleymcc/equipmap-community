import * as Sentry from "@sentry/react";
import { sanitizeDiagnostics } from './diagnosticPrivacy.js';
import { initializeDeviceDiagnostics, runtimeDiagnostics } from './diagnostics.js';

// Browser fixtures also serve production builds, but their failures are local.
const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
if (import.meta.env.VITE_SENTRY_DSN && import.meta.env.VITE_PORTABLE !== 'true' && !(import.meta.env.PROD && isLoopback)) {
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION || "equipmap-frontend@1.0.0",

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    // send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],

  // Tracing
  tracesSampleRate: 1.0,
  tracePropagationTargets: ["localhost", /^https?:\/\/localhost/, /^\/api/],

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,
  beforeSend: event => sanitizeDiagnostics({
    ...event, contexts: { ...event.contexts, runtime: runtimeDiagnostics() },
  }),
  beforeBreadcrumb: breadcrumb => sanitizeDiagnostics(breadcrumb),
  beforeSendLog: log => {
    const runtime = runtimeDiagnostics(false);
    return sanitizeDiagnostics({ ...log, attributes: {
      ...log.attributes,
      'device.user_agent': runtime.user_agent,
      'device.model': runtime.model || 'unavailable',
      'device.platform': runtime.platform,
      'device.viewport_width': runtime.viewport_width,
      'device.viewport_height': runtime.viewport_height,
      'device.pixel_ratio': runtime.pixel_ratio,
      'network.online': runtime.online,
      'app.route': runtime.route,
      'app.standalone': runtime.standalone,
    } });
  },
  // SDK diagnostics are useful locally, but noisy when telemetry is blocked.
  debug: import.meta.env.DEV,
});

void initializeDeviceDiagnostics();
}
