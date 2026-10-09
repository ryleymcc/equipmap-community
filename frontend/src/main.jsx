import './instrument';
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { trackButtonClick, trackPageLoadTime } from './metrics';

// Auto-recover when a new release replaces hashed JS chunks or dynamic imports fail
window.addEventListener('vite:preloadError', (event) => {
  console.warn('New deployment detected (stale chunk), reloading page to fetch latest version...', event);
  const reloadKey = 'equipmap_last_preload_reload';
  const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
  const now = Date.now();
  if (now - lastReload > 10000) {
    sessionStorage.setItem(reloadKey, String(now));
    window.location.reload();
  }
});

const intervalMS = 60 * 60 * 1000 // Check every hour

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // In development mode, register the standalone push worker (/sw-push.js)
    // so background push notifications work reliably even when the PWA is closed,
    // without caching or interfering with Vite's HMR source modules.
    navigator.serviceWorker.register('/sw-push.js', { scope: '/' }).catch(err => {
      console.warn('Service worker registration failed in DEV:', err);
    });
  } else {
    let refreshing = false;
    const handleServiceWorkerUpdate = () => {
      if (refreshing) return;
      // Do not interrupt active floorplan mapping sessions
      if (window.location.pathname.startsWith('/map/')) {
        console.log('New Service Worker activated; preserving active map session until navigation.');
        return;
      }
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleServiceWorkerUpdate);

    const updateSW = registerSW({
      immediate: true,
      // Override vite-plugin-pwa's autoUpdate default reload so map sessions
      // use the same guarded activation behavior as controllerchange.
      onNeedReload: handleServiceWorkerUpdate,
      onRegistered(registration) {
        if (registration) {
          setInterval(() => {
            console.log('Checking for SW update...')
            registration.update()
          }, intervalMS)
        }
      },
      onNeedRefresh() {
        if (window.location.pathname.startsWith('/map/')) {
          console.log('New version ready; preserving current map session.')
          return
        }
        updateSW(true)
      }
    });

    // Check for updates whenever the window is focused (app resumed on mobile).
    window.addEventListener('focus', () => {
      navigator.serviceWorker?.getRegistration().then(registration => {
        registration?.update()
      });
    });
  }
}

// Track initial app load time
window.addEventListener('load', () => {
  const loadTime = performance.now();
  trackPageLoadTime('app_initial_load', loadTime);
});

// Automatically track button clicks across the application
document.addEventListener('click', (event) => {
  const btn = event.target.closest('button, [role="button"], a.btn, a.nav-link');
  if (btn) {
    const label = btn.getAttribute('data-metric') ||
                  btn.getAttribute('aria-label') ||
                  btn.getAttribute('title') ||
                  btn.innerText?.trim()?.slice(0, 30) ||
                  btn.className?.slice(0, 30) ||
                  'button';
    if (label) {
      trackButtonClick(label);
    }
  }
}, { capture: true, passive: true });

// Prevent native iOS Safari pinch-to-zoom on the webpage viewport
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('gesturechange', (e) => e.preventDefault())
document.addEventListener('gestureend', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root'), {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
