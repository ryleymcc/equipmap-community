import './App.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import Dashboard from './pages/Dashboard';
import MapView from './pages/MapView';
import Remapper from './pages/Remapper';
import AuditHistory from './pages/AuditHistory';
import UserManagement from './pages/UserManagement';
import TaskManagement from './pages/TaskManagement';
import Login from './pages/Login';
import ChatGPTConnect from './pages/ChatGPTConnect';
import PublicRequestPortal from './pages/PublicRequestPortal';
import { AuthProvider } from './AuthContext';
import { OfflineProvider } from './OfflineContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { NotificationBlockedBanner } from './components/NotificationBlockedBanner';

function ErrorFallback({ error, resetError }) {
  const handleResetAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map(k => caches.delete(k)));
      }
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Error resetting cache on error fallback:', e);
    }
    resetError();
    window.location.href = '/';
  };

  return (
    <div className="glass-panel modal-card modal-md app-error-panel">
      <h2 className="m-0 text-primary">Something went wrong</h2>
      <p className="text-secondary m-0">
        An unexpected error occurred while loading this view. If a new version was recently published, clearing the local application cache will resolve it immediately.
      </p>
      <p className="app-error-details m-0">
        {error?.message || 'An unexpected error occurred'}
      </p>
      <div className="flex-center flex-wrap gap-md">
        <button
          onClick={() => { resetError(); window.location.reload(); }}
          className="btn btn-primary"
        >
          Reload Page
        </button>
        <button
          onClick={handleResetAndReload}
          className="btn btn-secondary"
        >
          Clear Cache & Reset App
        </button>
      </div>
    </div>
  );
}

function App() {
  const isOnline = useNetworkStatus();

  return (
    <Sentry.ErrorBoundary fallback={({ error, resetError }) => <ErrorFallback error={error} resetError={resetError} />}>
      <AuthProvider>
        <OfflineProvider>
          <NotificationBlockedBanner isOffline={!isOnline} />
          {!isOnline && (
            <div className="offline-banner">
              You are offline. Running in view-only mode.
            </div>
          )}
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/floorplans" element={<Dashboard />} />
              <Route path="/rooms" element={<Dashboard />} />
              <Route path="/equipment" element={<Dashboard />} />
              <Route path="/tickets" element={<Dashboard />} />
              <Route path="/work-orders" element={<Dashboard />} />
              <Route path="/map/:floorplanId" element={<MapView />} />
              <Route path="/remapper" element={<Remapper />} />
              <Route path="/audit-log" element={<AuditHistory />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/chatgpt-connect" element={<ChatGPTConnect />} />
              <Route path="/tasks" element={<TaskManagement />} />
              <Route path="/login" element={<Login />} />
              <Route path="/request" element={<PublicRequestPortal />} />
              <Route path="/request-maintenance" element={<PublicRequestPortal />} />
              <Route path="/maintenance-request" element={<PublicRequestPortal />} />
            </Routes>
          </BrowserRouter>
        </OfflineProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
