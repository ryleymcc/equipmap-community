/* global __BUILD_TIME__, __APP_VERSION__ */
import {
  Package,  Building, X, LayoutDashboard, DoorOpen, AlertCircle, History as HistoryIcon, Users, LogOut, LogIn, User as UserIcon,
  Cloud, CloudOff, RefreshCw
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useOffline } from '../OfflineContext';

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
      navigate('/issues');
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
            <span>Issues</span>
          </button>

          <button
            className={`drawer-nav-item ${activeView === 'audit-log' || activeView === 'audit-history' ? 'active' : ''}`}
            onClick={() => onNav('audit-log')}
          >
            <HistoryIcon size={20} className="nav-icon" />
            <span>Audit History</span>
          </button>


          {isAdmin && (
            <button
              className={`drawer-nav-item ${activeView === 'users' ? 'active' : ''}`}
              onClick={() => onNav('users')}
            >
              <Users size={20} className="nav-icon" />
              <span>User Management</span>
            </button>
          )}

        </nav>

        <div className="drawer-footer drawer-footer-bottom">


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
