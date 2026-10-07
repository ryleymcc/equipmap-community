import axios from 'axios';
import { trackResponseTime } from './metrics.js';

// Get the base API URL from environment or current origin
const DEFAULT_URL = typeof window !== 'undefined' ? window.location.origin : '';
export const API_URL = import.meta.env?.VITE_API_URL || DEFAULT_URL;

// Ensure API_URL doesn't have a trailing slash for consistency
export const BASE_URL = API_URL.replace(/\/$/, '');

export const api = axios.create({
  baseURL: BASE_URL,
});

// Add request timing metadata
api.interceptors.request.use((config) => {
  config.metadata = { startTime: performance.now() };
  return config;
});

// Add a response interceptor for token renewal & metrics
api.interceptors.response.use(
  (response) => {
    if (response.config?.metadata?.startTime) {
      const duration = performance.now() - response.config.metadata.startTime;
      const endpoint = response.config.url?.split('?')[0] || 'unknown';
      trackResponseTime(endpoint, duration, { status: String(response.status) });
    }
    return response;
  },
  async (error) => {
    if (error.config?.metadata?.startTime) {
      const duration = performance.now() - error.config.metadata.startTime;
      const endpoint = error.config.url?.split('?')[0] || 'unknown';
      trackResponseTime(endpoint, duration, { status: String(error.response?.status || 0) });
    }
    const originalRequest = error.config;
    // Don't try to refresh if we are offline, if it's already a retry, or if it's an auth endpoint itself
    const isAuthEndpoint = originalRequest?.url?.includes('/api/token') || originalRequest?.url?.includes('/api/refresh-token') || originalRequest?.url?.includes('/api/auth/logout');
    if (error.response?.status === 401 && !originalRequest._retry && localStorage.getItem('token') && navigator.onLine && !isAuthEndpoint) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        let res;
        if (refreshToken) {
          // Preferred: use refresh token rotation
          res = await axios.post(`${BASE_URL}/api/refresh-token`, { refresh_token: refreshToken });
        } else {
          // Fallback: use existing access token (backwards compatibility)
          res = await axios.post(`${BASE_URL}/api/refresh-token`, {}, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
        }
        const { access_token, refresh_token: new_refresh_token } = res.data;
        localStorage.setItem('token', access_token);
        if (new_refresh_token) {
          localStorage.setItem('refresh_token', new_refresh_token);
        }
        api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
        originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export const LOW_PRIORITY_CONFIG = {
  priority: 'low',
  headers: {
    'Priority': 'u=6, i'
  }
};

export const getSites = (config) => api.get('/api/sites', config);
export const createSite = (data) => api.post('/api/sites', data);
export const updateSite = (siteId, data) => api.put(`/api/sites/${siteId}`, data);
export const deleteSite = (siteId) => api.delete(`/api/sites/${siteId}`);
export const checkSyncUpdates = (etags, config) => api.post('/api/sync/check-updates', { etags }, config);

export const getFloorplans = (siteId, config) => api.get(`/api/sites/${siteId}/floorplans`, config);
export const getFloorplan = (id, config) => api.get(`/api/floorplans/${id}`, config);
export const uploadFloorplan = (formData) => api.post('/api/floorplans', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const deleteFloorplan = (floorplanId) => api.delete(`/api/floorplans/${floorplanId}`);
export const updateFloorplan = (floorplanId, data) => api.put(`/api/floorplans/${floorplanId}`, data);
export const replaceFloorplanFile = (floorplanId, formData) => api.put(`/api/floorplans/${floorplanId}/file`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const rescaleFloorplan = (floorplanId, data) => api.post(`/api/floorplans/${floorplanId}/rescale`, data);
export const updateFloorplansSortOrder = (siteId, data) => api.put(`/api/sites/${siteId}/floorplans/sort`, data);

export const getRooms = (floorplanId, config) => api.get(`/api/floorplans/${floorplanId}/rooms`, config);
export const createRoom = (data) => api.post('/api/rooms', data);
export const deleteRoom = (id) => api.delete(`/api/rooms/${id}`);
export const getEquipment = (floorplanId, config) => api.get(`/api/floorplans/${floorplanId}/equipment`, config);
export const createEquipment = (formData) => api.post('/api/equipment', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const updateEquipment = (id, formData) => api.put(`/api/equipment/${id}`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const bulkUpdateEquipment = (data) => api.put('/api/equipment/bulk', data);
export const deleteEquipment = (id) => api.delete(`/api/equipment/${id}`);
export const batchImportEquipment = (data) => api.post('/api/equipment/batch', data);

export const getAllEquipment = (config) => api.get('/api/equipment', config);
export const getAllRooms = (config) => api.get('/api/rooms', config);
export const updateRoom = (id, data) => api.put(`/api/rooms/${id}`, data);

export const searchAll = (query, config) => api.get(`/api/search?q=${encodeURIComponent(query)}`, config);

export const getAuditLogs = (config) => api.get('/api/audit-logs', config);
export const undoAction = (logId) => api.post(`/api/audit-logs/${logId}/undo`);

export const getRefPoints = (fpId, config) => api.get(`/api/floorplans/${fpId}/reference-points`, config);
export const setRefPoints = (fpId, points) => api.put(`/api/floorplans/${fpId}/reference-points`, { points });

// Users
export const getUsers = (config) => api.get('/api/users', config);
export const createUser = (data) => api.post('/api/users', data);
export const updateUser = (id, data) => api.put(`/api/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/api/users/${id}`);
export const getAssignableUsers = (config) => api.get('/api/users/assignable', config);

export function getErrorMessage(error, defaultMsg = 'An error occurred') {
  if (!error) return defaultMsg;
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map(d => {
        if (typeof d === 'object' && d !== null) {
          const loc = Array.isArray(d.loc) ? d.loc.filter(l => l !== 'body' && l !== 'query').join('.') : '';
          const msg = d.msg || d.message || JSON.stringify(d);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(d);
      })
      .join('; ') || defaultMsg;
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return error.message || defaultMsg;
}

// Tickets
export const getAllTickets = (config) => api.get('/api/tickets', config);
export const createTicket = (ticketData) => api.post('/api/tickets', ticketData);
export const updateTicket = (id, ticketData) => api.put(`/api/tickets/${id}`, ticketData);
export const deleteTicket = (id) => api.delete(`/api/tickets/${id}`);
