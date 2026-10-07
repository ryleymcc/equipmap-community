import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import Dashboard from './pages/Dashboard';
import MapView from './pages/MapView';
import AuditHistory from './pages/AuditHistory';
import UserManagement from './pages/UserManagement';
import Login from './pages/Login';
import ChatGPTConnect from './pages/ChatGPTConnect';
import { AuthProvider } from './AuthContext';
import { OfflineProvider } from './OfflineContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { consumeDeferredPwaUpdate } from './pwaUpdate';

function DeferredPwaUpdate() {
  const { pathname } = useLocation();
  const previousPathname = React.useRef(pathname);

  React.useEffect(() => {
    if (previousPathname.current !== pathname && consumeDeferredPwaUpdate()) {
      window.location.reload();
      return;
    }

    previousPathname.current = pathname;
  }, [pathname]);

  return null;
}

function ErrorFallback({ error, resetError }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Something went wrong.</h2>
      <p style={{ color: '#ef4444' }}>{error?.message || 'An unexpected error occurred'}</p>
      <button
        onClick={() => { resetError(); window.location.reload(); }}
        style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '1rem' }}
      >
        Reload Page
      </button>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function SentryDebug() {
  const [shouldThrow, setShouldThrow] = React.useState(false);

  if (shouldThrow) {
    throw new Error('Sentry Frontend Test Error: React Error Boundary & Uncaught Exception Verification');
  }

  const emitMetrics = () => {
    Sentry.metrics.count('button_click', 1);
    Sentry.metrics.gauge('page_load_time', 150);
    Sentry.metrics.distribution('response_time', 200);
  };

  React.useEffect(() => {
    // Automatically trigger test exception and metrics on mount
    Sentry.captureException(new Error('Sentry Frontend Test Error: Automatic Verification Event'));
    emitMetrics();
  }, []);

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Sentry Frontend Verification</h2>
      <p>Test error and metrics dispatched to Sentry on mount.</p>
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            Sentry.captureException(new Error('Sentry Frontend Test Error: Captured via Sentry.captureException'));
            alert('Sent manual exception to Sentry!');
          }}
          style={{ padding: '0.6rem 1.2rem', background: '#e11d48', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Capture Manual Exception
        </button>
        <button
          onClick={() => {
            emitMetrics();
            alert('Emitted test metrics (count, gauge, distribution) to Sentry!');
          }}
          style={{ padding: '0.6rem 1.2rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Emit Metrics (Count/Gauge/Dist)
        </button>
        <button
          onClick={() => setShouldThrow(true)}
          style={{ padding: '0.6rem 1.2rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Throw Uncaught Render Error
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
          {!isOnline && (
            <div className="offline-banner">
              You are offline. Running in view-only mode.
            </div>
          )}
          <BrowserRouter>
            <DeferredPwaUpdate />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/rooms" element={<Dashboard />} />
              <Route path="/equipment" element={<Dashboard />} />
              <Route path="/issues" element={<Dashboard />} />
              <Route path="/tickets" element={<Dashboard />} />

              <Route path="/map/:floorplanId" element={<MapView />} />
              <Route path="/audit-log" element={<AuditHistory />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/login" element={<Login />} />
              <Route path="/connect/chatgpt" element={<ChatGPTConnect />} />
            </Routes>
          </BrowserRouter>
        </OfflineProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
