/* global __BUILD_TIME__, __APP_VERSION__ */
import { useState, useEffect } from 'react';
import {
  Building, X, LayoutDashboard, Package, DoorOpen, AlertCircle, ClipboardList,
  History as HistoryIcon, Users, Shuffle, LogOut, LogIn, User as UserIcon,
  Cloud, CloudOff, RefreshCw, Bell, BellRing, BellOff, BookOpen
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useOffline } from '../OfflineContext';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  subscribeUserToPush,
  unsubscribeUserFromPush
} from '../pushNotifications';
import { NotificationBlockedModal } from './NotificationBlockedModal';

export default function DashboardLeftDrawer({
  isOpen,
  onClose,
  activeView,
  handleNavClick,
  user: propUser,
  logout: propLogout,
  isAdmin: propIsAdmin,
  navigate: propNavigate,
  location: propLocation,
  activeSite
}) {
  const auth = useAuth();
  const routerNavigate = useNavigate();
  const routerLocation = useLocation();

  const user = propUser !== undefined ? propUser : auth?.user;
  const logout = propLogout !== undefined ? propLogout : auth?.logout;
  const isAdmin = propIsAdmin !== undefined ? propIsAdmin : auth?.isAdmin;
  const navigate = propNavigate || routerNavigate;
  const location = propLocation || routerLocation;
  const { isSyncing, lastSyncTime, syncData } = useOffline();

  const currentPathObj = {
    pathname: location?.pathname || '/',
    search: location?.search || '',
    hash: location?.hash || ''
  };

  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [isSubscribingNotif, setIsSubscribingNotif] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);

  useEffect(() => {
    const updatePermission = () => setNotifPermission(getNotificationPermission());
    window.addEventListener('focus', updatePermission);
    return () => window.removeEventListener('focus', updatePermission);
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

  const onNav = (view) => {
    if (view === 'audit-log' || view === 'audit-history') {
      if (onClose) onClose();
      if (activeView !== 'audit-log' && activeView !== 'audit-history') {
        navigate('/audit-log', { state: { from: currentPathObj } });
      }
      return;
    }
    if (view === 'users') {
      if (onClose) onClose();
      if (activeView !== 'users') {
        navigate('/users', { state: { from: currentPathObj } });
      }
      return;
    }
    if (view === 'tasks') {
      if (onClose) onClose();
      if (activeView !== 'tasks') {
        navigate('/tasks', { state: { from: currentPathObj } });
      }
      return;
    }
    if (view === 'remapper') {
      if (onClose) onClose();
      if (activeView !== 'remapper') {
        navigate('/remapper', { state: { from: currentPathObj } });
      }
      return;
    }

    if (handleNavClick) {
      handleNavClick(view);
      return;
    }
    if (onClose) onClose();
    if (view === 'floorplans') {
      navigate('/floorplans');
    } else if (view === 'equipment') {
      navigate('/equipment');
    } else if (view === 'rooms') {
      navigate('/rooms');
    } else if (view === 'tickets') {
      navigate('/tickets');
    } else if (view === 'workorders') {
      navigate('/work-orders');
    }
  };

  return (
    <>
      {/* Left Drawer Overlay */}
      {isOpen && (
        <div className="drawer-overlay" onClick={onClose} />
      )}

      {/* Left Drawer Menu */}
      <div className={`drawer drawer-left ${isOpen ? 'drawer-open' : ''}`}>
        <div className="drawer-header">
          <div className="items-center gap-md">
            <Building size={22} color="var(--primary-color)" />
            <h3 className="m-0">EquipMap</h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
            onClick={onClose}
            title="Close Menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="drawer-nav">

          {(
            <button
              className={`drawer-nav-item ${activeView === 'workorders' ? 'active' : ''}`}
              onClick={() => onNav('workorders')}
            >
              <ClipboardList size={20} className="nav-icon" />
              <span>Work Orders</span>
            </button>
          )}

          <button
            className={`drawer-nav-item ${activeView === 'floorplans' ? 'active' : ''}`}
            onClick={() => onNav('floorplans')}
          >
            <LayoutDashboard size={20} className="nav-icon" />
            <span>Floorplans</span>
          </button>

          <button
            className={`drawer-nav-item ${activeView === 'equipment' ? 'active' : ''}`}
            onClick={() => onNav('equipment')}
          >
            <Package size={20} className="nav-icon" />
            <span>Equipment</span>
          </button>

          <button
            className={`drawer-nav-item ${activeView === 'rooms' ? 'active' : ''}`}
            onClick={() => onNav('rooms')}
          >
            <DoorOpen size={20} className="nav-icon" />
            <span>Rooms</span>
          </button>

          <button
            className={`drawer-nav-item ${activeView === 'tickets' ? 'active' : ''}`}
            onClick={() => onNav('tickets')}
          >
            <AlertCircle size={20} className="nav-icon" />
            <span>Issue Tickets</span>
          </button>

          <button
            className={`drawer-nav-item ${activeView === 'audit-log' || activeView === 'audit-history' ? 'active' : ''}`}
            onClick={() => onNav('audit-log')}
          >
            <HistoryIcon size={20} className="nav-icon" />
            <span>Audit History</span>
          </button>

          {(isAdmin || auth?.canCreatePM || user?.can_create_pm) && (
            <button
              className={`drawer-nav-item ${activeView === 'tasks' ? 'active' : ''}`}
              onClick={() => onNav('tasks')}
            >
              <BookOpen size={20} className="nav-icon" />
              <span>Task Templates</span>
            </button>
          )}

          {isAdmin && (
            <button
              className={`drawer-nav-item ${activeView === 'users' ? 'active' : ''}`}
              onClick={() => onNav('users')}
            >
              <Users size={20} className="nav-icon" />
              <span>User Management</span>
            </button>
          )}

          <div className="drawer-divider" />

          <button
            className={`drawer-nav-item ${activeView === 'remapper' ? 'active' : ''}`}
            onClick={() => onNav('remapper')}
          >
            <Shuffle size={20} className="nav-icon" />
            <span>Remapper</span>
          </button>
        </nav>

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
                  <span className="text-sm font-semibold text-primary text-truncate">{user.full_name || user.username}</span>
                  <span className="text-xs text-muted uppercase">{user.role}</span>
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
                onClick={() => {
                  const params = new URLSearchParams(location.search);
                  if (activeSite) params.set('siteId', activeSite.id);
                  navigate('/login', {
                    state: {
                      from: {
                        pathname: location.pathname,
                        search: `?${params.toString()}`,
                        hash: location.hash
                      }
                    }
                  });
                }}
                className="btn btn-primary btn-full gap-sm"
              >
                <LogIn size={18} />
                <span>Sign In</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
