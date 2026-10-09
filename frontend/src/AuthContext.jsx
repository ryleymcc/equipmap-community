/* eslint react-refresh/only-export-components: ["warn", { "allowConstantExport": true }] -- AuthProvider and useAuth share the established context module. */
import  { createContext, useState, useContext, useEffect } from 'react';
import { api } from './api';
import { clearAllClientCaches } from './cacheUtils';
import {
  autoEnablePushNotifications,
  getNotificationPermission,
  unsubscribeUserFromPush
} from './pushNotifications';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('token')));
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      // Set token for initial requests
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchMe();
    }
  }, []);

  async function fetchMe() {
    try {
      const res = await api.get('/api/users/me');
      setUser(res.data);
      if (res.data?.id) {
        autoEnablePushNotifications(res.data.id).then(() => {
          setNotifPermission(getNotificationPermission());
        });
      }
    } catch (error) {
      console.warn('Failed to fetch user with stored token:', error);
      await logout();
    } finally {
      setLoading(false);
    }
  };

  async function login(username, password) {
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    const res = await api.post('/api/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    const { access_token, refresh_token } = res.data;

    localStorage.setItem('token', access_token);
    if (refresh_token) {
      localStorage.setItem('refresh_token', refresh_token);
    }
    api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

    const userRes = await api.get('/api/users/me');
    setUser(userRes.data);
    if (userRes.data?.id) {
      autoEnablePushNotifications(userRes.data.id).then(() => {
        setNotifPermission(getNotificationPermission());
      });
    }
    return userRes.data;
  };

  async function logout() {
    if (user?.id) {
      unsubscribeUserFromPush(user.id);
    }
    // Call server-side logout to revoke tokens
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        await api.post('/api/auth/logout', { refresh_token: refreshToken });
      }
    } catch (err) {
      // Proceed with local logout even if server-side fails
      console.warn('Server-side logout failed:', err);
    }
    clearAllClientCaches();
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_admin));
  const isTechnician = Boolean(isAdmin || (user && (user.role === 'technician' || user.role === 'editor')));
  const canTriage = Boolean(isAdmin || (user && user.role !== 'viewer' && user.can_triage));
  const canAssign = Boolean(isAdmin || (user && user.role !== 'viewer' && (user.can_assign || user.can_triage)));
  const canCreatePM = Boolean(isAdmin || (user && user.role !== 'viewer' && user.can_create_pm));
  const canCreateWorkOrders = Boolean(isAdmin || (user && user.role !== 'viewer' && user.can_create_work_orders !== false));
  const canManageItems = Boolean(isAdmin || (user && user.role !== 'viewer' && (user.can_manage_items !== false || user.role === 'editor')));
  const isEditor = canManageItems;
  const canCloseWorkOrders = Boolean(isAdmin || (user && user.role !== 'viewer' && user.can_close_work_orders !== false));
  const canUndoAllAuditLogs = Boolean(isAdmin || (user && user.can_undo_all_audit_logs));

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading,
      isAdmin, isTechnician, isEditor,
      canTriage, canAssign, canCreatePM,
      canCreateWorkOrders, canManageItems, canCloseWorkOrders,
      canUndoAllAuditLogs,
      notifPermission, setNotifPermission,
      autoEnablePushNotifications
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
