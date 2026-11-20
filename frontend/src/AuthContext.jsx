/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { api } from './api';
import { clearAllClientCaches } from './cacheUtils';

const AuthContext = createContext(null);

export function canManageEquipMapItems(user) {
  return Boolean(user && (
    user.role === 'admin' || user.role === 'editor' ||
    (user.role !== 'viewer' && user.can_manage_items)
  ));
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    const pending = [];
    if (refreshToken) pending.push(api.post('/api/auth/logout', { refresh_token: refreshToken }));
    pending.push(clearAllClientCaches());
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
    await Promise.allSettled(pending);
  }, []);

  const login = useCallback(async (username, password) => {
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

    return userRes.data;
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/api/users/me');
      setUser(res.data);
    } catch (error) {
      console.warn('Failed to fetch user with stored token:', error);
      // A disconnected device must retain its session and offline entity/photo caches.
      // Only an explicit authentication rejection invalidates the saved session.
      if (!error.response || ![401, 403].includes(error.response.status)) return;
      await logout();
      if (import.meta.env.VITE_DEMO_MODE === 'true') {
        try {
          await login('demo', 'demo123');
        } catch (demoErr) {
          console.warn('Demo auto-login fallback failed:', demoErr);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [login, logout]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      // Set token for initial requests
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      queueMicrotask(() => {
        fetchMe();
      });
    } else if (import.meta.env.VITE_DEMO_MODE === 'true') {
      // Auto-login demo visitor for instant access
      queueMicrotask(() => {
        login('demo', 'demo123').catch(err => {
          console.warn('Demo auto-login fallback:', err);
          setLoading(false);
        });
      });
    } else {
      queueMicrotask(() => setLoading(false));
    }
  }, [fetchMe, login]);

  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_admin));
  const isTechnician = Boolean(isAdmin || (user && (user.role === 'technician' || user.role === 'editor')));
  const canManageItems = canManageEquipMapItems(user);
  const isEditor = canManageItems;
  const canUndoAllAuditLogs = Boolean(isAdmin || (user && user.can_undo_all_audit_logs));

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading,
      isAdmin, isTechnician, isEditor,
      canManageItems,
      canUndoAllAuditLogs,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
