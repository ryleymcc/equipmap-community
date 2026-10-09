/* global __APP_VERSION__, __BUILD_TIME__ */
import { memo, useState, useEffect } from 'react';
import { X, ArrowLeft, Map as MapIcon, Check, AlertTriangle, Crosshair, User as UserIcon, LogOut, LogIn, Cloud, CloudOff, RefreshCw, Loader2, Bell, BellRing, BellOff } from 'lucide-react';
import { useOffline } from '../OfflineContext';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  subscribeUserToPush,
  unsubscribeUserFromPush
} from '../pushNotifications';
import { NotificationBlockedModal } from './NotificationBlockedModal';

export const LeftDrawer = memo(function LeftDrawer({
  isOpen,
  onClose,
  floorplan,
  floorplanId,
  siteFloorplans,
  onFloorplanSwitch,
  switchingToFloorplanId,
  isEditor,
  onEnterCalibration,
  user,
  logout,
  navigate,
  location
}) {
  const numericFloorplanId = parseInt(floorplanId, 10);
  const returnTo = location?.state?.returnTo;
  const hasDashboardReturn = Boolean(returnTo?.pathname?.startsWith('/'));
  const backLabels = {
    '/work-orders': 'Work Orders',
    '/equipment': 'Equipment',
    '/rooms': 'Rooms',
    '/tickets': 'Issue Tickets'
  };
  const backLabel = backLabels[returnTo?.pathname] || 'Dashboard';
  const { isSyncing, lastSyncTime, syncData } = useOffline();

  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [isSubscribingNotif, setIsSubscribingNotif] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
  }, [user]);

  const handleToggleNotifications = async () => {
    if (!user?.id) return;
    setIsSubscribingNotif(true);
    try {
      if (notifPermission === 'granted') {
        await unsubscribeUserFromPush(user.id);
        setNotifPermission('default');
      } else {
        const res = await subscribeUserToPush(user.id);
        if (res.success) {
          setNotifPermission('granted');
        } else if (res.reason === 'permission_denied') {
          setNotifPermission('denied');
        }
      }
    } finally {
      setIsSubscribingNotif(false);
    }
  };

  const handleBackToDashboard = () => {
    if (hasDashboardReturn) {
      navigate(`${returnTo.pathname}${returnTo.search || ''}`, {
        replace: true,
        state: Number.isFinite(returnTo.scrollY)
          ? {
              restoreScrollY: returnTo.scrollY,
              restoreScrollStorageKey: returnTo.scrollStorageKey
            }
          : undefined
      });
      return;
    }

    const siteId = floorplan?.site_id;
    navigate(siteId ? `/?siteId=${siteId}` : '/');
  };

  return (
    <div className={`drawer drawer-left ${isOpen ? 'drawer-open' : ''}`}>
      <div className="drawer-header">
        <h3>Menu</h3>
        <button
          type="button"
          className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
          onClick={onClose}
          title="Close Menu"
        >
          <X size={18} />
        </button>
      </div>

      <button
        className="btn btn-secondary btn-full mb-xl"
        onClick={handleBackToDashboard}
      >
        <ArrowLeft size={18} /> Back to {backLabel}
      </button>

      {/* Floorplans List */}
      <div className="input-group">
        <label>Floorplans Switcher</label>
        <div className="drawer-floorplan-list">
          {siteFloorplans.map(fp => {
            const currentFpPoints = fp.id === numericFloorplanId
              ? (floorplan?.reference_points?.length === 2 ? floorplan.reference_points : (fp.reference_points || []))
              : (fp.reference_points || []);
            const hasCalibration = currentFpPoints.length === 2;
            const isSwitchingThis = switchingToFloorplanId === fp.id;
            const isActive = fp.id === numericFloorplanId || isSwitchingThis;
            return (
              <div
                key={fp.id}
                className={`drawer-floorplan-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (fp.id !== numericFloorplanId && !isSwitchingThis) {
                    onFloorplanSwitch(fp);
                  }
                }}
              >
                {isSwitchingThis ? (
                  <Loader2 size={18} className="spinning" color="var(--primary-color)" />
                ) : (
                  <MapIcon size={18} color="var(--primary-color)" />
                )}
                <span className={`text-sm flex-1 ${isActive ? 'font-semibold' : 'font-normal'}`}>
                  {fp.name}
                </span>
                {hasCalibration ? (
                  <span className="calibration-badge calibrated" title="Calibrated">
                    <Check size={14} />
                  </span>
                ) : (
                  <span className="calibration-badge" title="Not calibrated — alignment unavailable">
                    <AlertTriangle size={14} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Calibrate Alignment Button */}
      {isEditor && (
        <button
          className="btn btn-secondary btn-full mt-sm gap-sm"
          onClick={onEnterCalibration}
        >
          <Crosshair size={16} />
          {(floorplan?.reference_points || []).length === 2 ? 'Edit Calibration' : 'Calibrate Alignment'}
        </button>
      )}

      <div className="mt-auto pt-xl">
        <div className="drawer-footer drawer-footer-bottom">
          {/* Push Notifications Toggle */}
          {user && isPushNotificationSupported() && (
            <div className="drawer-notif-box">
              <div className="flex-between items-center gap-sm">
                <div className="items-center gap-sm overflow-hidden">
                  {notifPermission === 'granted' ? (
                    <BellRing size={14} color="#10b981" />
                  ) : notifPermission === 'denied' ? (
                    <BellOff size={14} color="#ef4444" />
                  ) : (
                    <Bell size={14} color="var(--text-secondary)" />
                  )}
                  <span className="text-xs font-semibold text-primary text-truncate">
                    {notifPermission === 'granted'
                      ? 'Push notifications active'
                      : notifPermission === 'denied'
                      ? 'Notifications blocked'
                      : 'Push notifications'}
                  </span>
                </div>
                {notifPermission === 'denied' ? (
                  <button
                    onClick={() => setIsBlockedModalOpen(true)}
                    className="btn btn-primary"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: '#ef4444' }}
                    title="Notifications blocked in browser. Click for instructions to unblock."
                  >
                    Unblock
                  </button>
                ) : (
                  <button
                    onClick={handleToggleNotifications}
                    disabled={isSubscribingNotif}
                    className={`btn ${notifPermission === 'granted' ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    title={notifPermission === 'granted' ? 'Disable push notifications' : 'Enable push notifications for assigned work orders'}
                  >
                    {isSubscribingNotif
                      ? '...'
                      : notifPermission === 'granted'
                      ? 'Disable'
                      : 'Enable'}
                  </button>
                )}
              </div>
            </div>
          )}

          <NotificationBlockedModal
            isOpen={isBlockedModalOpen}
            onClose={() => setIsBlockedModalOpen(false)}
            userId={user?.id}
            onPermissionChanged={(newPerm) => setNotifPermission(newPerm)}
          />

          {/* Offline Sync Status */}
          <div className="drawer-sync-box">
            <div className="items-center gap-sm mb-xs">
              {isSyncing ? (
                <RefreshCw size={14} className="spinning" color="var(--primary-color)" />
              ) : lastSyncTime ? (
                <Cloud size={14} color="#10b981" />
              ) : (
                <CloudOff size={14} color="#f59e0b" />
              )}
              <span className="text-xs font-semibold text-primary">
                {isSyncing ? 'Downloading content...' : lastSyncTime ? 'Ready for offline mode' : 'Not ready for offline mode'}
              </span>
              {!isSyncing && (
                <button
                  onClick={(e) => { e.stopPropagation(); syncData(); }}
                  className="btn-link-sync"
                  title="Sync Now"
                >
                  <RefreshCw size={12} color="var(--text-secondary)" />
                </button>
              )}
            </div>
            {lastSyncTime && (
              <div className="drawer-sync-meta">
                Last updated: {lastSyncTime}
              </div>
            )}
            <div className="drawer-sync-meta muted">
              v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'} • {__BUILD_TIME__}
            </div>
          </div>

          {user ? (
            <div className="user-profile-sidebar flex-between gap-sm p-md">
              <div className="items-center gap-md overflow-hidden">
                <div className="avatar-circle">
                  <UserIcon size={18} />
                </div>
                <div className="flex-column overflow-hidden">
                  <span className="text-sm font-semibold text-primary text-truncate">
                    {user.full_name || user.username}
                  </span>
                  <span className="text-xs text-muted uppercase">
                    {user.role}
                  </span>
                </div>
              </div>
              <button
                onClick={logout}
                className="btn btn-secondary btn-icon"
                title="Log Out"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="p-md">
              <button
                onClick={() => navigate('/login', {
                  state: {
                    from: {
                      pathname: location.pathname,
                      search: location.search,
                      hash: location.hash
                    }
                  }
                })}
                className="btn btn-primary btn-full gap-sm"
              >
                <LogIn size={18} />
                <span>Sign In</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
