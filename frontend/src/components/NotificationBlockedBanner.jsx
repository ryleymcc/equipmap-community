import  { useState, useEffect } from 'react';
import { BellOff, X } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { isPushNotificationSupported, getNotificationPermission } from '../pushNotifications';
import { NotificationBlockedModal } from './NotificationBlockedModal';

export function NotificationBlockedBanner({ isOffline }) {
  const { user } = useAuth();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [isDismissed, setIsDismissed] = useState(() => sessionStorage.getItem('equipmap_notif_banner_dismissed') === 'true');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const updatePerm = () => {
      setPermission(getNotificationPermission());
    };

    window.addEventListener('focus', updatePerm);
    return () => window.removeEventListener('focus', updatePerm);
  }, [user]);

  if (!user || !isPushNotificationSupported() || permission !== 'denied' || isDismissed) {
    return (
      <NotificationBlockedModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userId={user?.id}
        onPermissionChanged={(newPerm) => setPermission(newPerm)}
      />
    );
  }

  const handleDismiss = () => {
    sessionStorage.setItem('equipmap_notif_banner_dismissed', 'true');
    setIsDismissed(true);
  };

  return (
    <>
      <div
        className={`notif-blocked-banner ${isOffline ? 'with-offline-banner' : ''}`}
        role="alert"
      >
        <div className="notif-blocked-content">
          <div className="notif-blocked-icon-box">
            <BellOff size={15} color="#ef4444" />
          </div>
          <span className="notif-blocked-text">
            Work order notifications are blocked by your browser.
          </span>
          <button
            type="button"
            className="notif-blocked-action-btn"
            onClick={() => setIsModalOpen(true)}
          >
            How to Enable
          </button>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="notif-blocked-close-btn"
          title="Dismiss for this session"
        >
          <X size={14} />
        </button>
      </div>

      <NotificationBlockedModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userId={user?.id}
        onPermissionChanged={(newPerm) => setPermission(newPerm)}
      />
    </>
  );
}
