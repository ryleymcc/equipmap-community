import  { useState } from 'react';
import { BellOff, X, CheckCircle2, ShieldAlert, Laptop, Smartphone } from 'lucide-react';
import { getNotificationPermission, subscribeUserToPush } from '../pushNotifications';

export function NotificationBlockedModal({ isOpen, onClose, userId, onPermissionChanged }) {
  const [checking, setChecking] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [activeTab, setActiveTab] = useState('desktop');

  if (!isOpen) return null;

  const handleRecheck = async () => {
    setChecking(true);
    try {
      const currentPerm = getNotificationPermission();
      if (currentPerm === 'granted') {
        if (userId) {
          await subscribeUserToPush(userId);
        }
        setResolved(true);
        if (onPermissionChanged) onPermissionChanged('granted');
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        // Try prompting if moved from denied to default
        if (typeof Notification !== 'undefined' && Notification.requestPermission) {
          const newPerm = await Notification.requestPermission();
          if (newPerm === 'granted') {
            if (userId) await subscribeUserToPush(userId);
            setResolved(true);
            if (onPermissionChanged) onPermissionChanged('granted');
            setTimeout(() => onClose(), 1200);
          }
        }
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="modal-card modal-md glass-panel modal-card-notif-instructions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card-header">
          <div className="flex items-center gap-sm">
            <div className="icon-box-danger">
              <BellOff size={18} />
            </div>
            <div>
              <h3 className="m-0 text-base font-bold text-primary">Notifications Blocked</h3>
              <p className="m-0 text-xs text-muted">
                Enable permissions to receive work order assignment alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-card-body">
          {resolved ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 0.75rem auto' }} />
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#10b981' }}>Notifications Enabled!</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
                This device is now registered to receive assignment notifications.
              </p>
            </div>
          ) : (
            <>
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem'
              }}>
                <ShieldAlert size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.825rem', lineHeight: '1.4' }}>
                  <strong>Push notifications are currently blocked</strong> in your browser settings. Follow the quick steps below to allow notifications.
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--surface-border)', paddingBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('desktop')}
                  className={`btn btn-sm ${activeTab === 'desktop' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ gap: '0.4rem', fontSize: '0.8rem' }}
                >
                  <Laptop size={14} />
                  <span>Desktop (Chrome, Edge, Safari)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('mobile')}
                  className={`btn btn-sm ${activeTab === 'mobile' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ gap: '0.4rem', fontSize: '0.8rem' }}
                >
                  <Smartphone size={14} />
                  <span>Mobile (iOS & Android)</span>
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'desktop' ? (
                <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Look for the <strong>🔒 Padlock / Site Settings icon</strong> on the left side of your browser address bar.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Click it and toggle <strong>Notifications</strong> to <strong>Allow</strong>.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Click <strong>"I've Unblocked It"</strong> below to register this device.
                  </li>
                </ol>
              ) : (
                <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>iOS Safari:</strong> Add to Home Screen, open the app, and go to <em>Settings &gt; Safari / App Settings &gt; Notifications &gt; Allow</em>.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>Android Chrome:</strong> Tap the <strong>🔒 Lock icon</strong> or <strong>⋮ Menu &gt; Site settings &gt; Notifications</strong>, select this site and tap <strong>Allow</strong>.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Tap <strong>"I've Unblocked It"</strong> below once enabled.
                  </li>
                </ol>
              )}
            </>
          )}
        </div>

        <div className="modal-card-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
          >
            {resolved ? 'Close' : 'Cancel'}
          </button>
          {!resolved && (
            <button
              type="button"
              onClick={handleRecheck}
              disabled={checking}
              className="btn btn-primary btn-sm gap-xs"
            >
              {checking ? 'Checking...' : "I've Unblocked It"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
