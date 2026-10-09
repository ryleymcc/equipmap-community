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

// Add a request interceptor for auth headers & timing
api.interceptors.request.use((config) => {
  config.metadata = { startTime: performance.now() };
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token && !config.headers.Authorization && !config.headers.authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
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

// Trades
export const getTrades = (config) => api.get('/api/trades', config);
export const getTradesSummary = (config) => api.get('/api/trades/summary', config);
export const createTrade = (data) => api.post('/api/trades', data);
export const updateTrade = (tradeName, data) => api.put(`/api/trades/${encodeURIComponent(tradeName)}`, data);
export const deleteTrade = (tradeName, data) => api.delete(`/api/trades/${encodeURIComponent(tradeName)}`, { data });

// Users
export const getUsers = (config) => api.get('/api/users', config);
export const createUser = (data) => api.post('/api/users', data);
export const updateUser = (id, data) => api.put(`/api/users/${id}`, data);
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

// Native Work Orders
export const getWorkOrders = (params = {}, config = {}) => {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status_filter', params.status);
  if (params.priority && params.priority !== 'all') query.set('priority', params.priority);
  if (params.category && params.category !== 'all') query.set('category', params.category);
  if (params.trade && params.trade !== 'all') query.set('trade', params.trade);
  if (params.assigned_user_id && params.assigned_user_id !== 'all') query.set('assigned_user_id', String(params.assigned_user_id));
  if (params.site_id) query.set('site_id', String(params.site_id));
  if (params.floorplan_id) query.set('floorplan_id', String(params.floorplan_id));
  if (params.room_id) query.set('room_id', String(params.room_id));
  if (params.equipment_id) query.set('equipment_id', String(params.equipment_id));
  if (params.search) query.set('search', params.search);
  if (params.force_refresh) query.set('_t', String(Date.now()));

  const qs = query.toString();
  return api.get(`/api/work-orders${qs ? `?${qs}` : ''}`, config);
};

export const getWorkOrder = (id, config) => api.get(`/api/work-orders/${id}`, config);
export const createWorkOrder = (data) => api.post('/api/work-orders', data);
export const createPublicWorkOrder = (data) => api.post('/api/work-orders/public', data);
export const updateWorkOrder = (id, data) => api.put(`/api/work-orders/${id}`, data);
export const addWorkOrderLabor = (id, data) => api.post(`/api/work-orders/${id}/labor`, data);
export const updateWorkOrderLabor = (woId, laborId, data) => api.put(`/api/work-orders/${woId}/labor/${laborId}`, data);
export const deleteWorkOrderLabor = (woId, laborId) => api.delete(`/api/work-orders/${woId}/labor/${laborId}`);
export const addWorkOrderComment = (id, data) => api.post(`/api/work-orders/${id}/comments`, data);
export const updateWorkOrderComment = (woId, commentId, data) => api.put(`/api/work-orders/${woId}/comments/${commentId}`, data);
export const deleteWorkOrderComment = (woId, commentId) => api.delete(`/api/work-orders/${woId}/comments/${commentId}`);
export const closeWorkOrder = (id, data = {}) => api.post(`/api/work-orders/${id}/close`, data);
export const deleteWorkOrder = (id) => api.delete(`/api/work-orders/${id}`);
export const bulkCloseWorkOrders = (data) => api.post('/api/work-orders/bulk/close', data);
export const bulkAssignWorkOrders = (data) => api.post('/api/work-orders/bulk/assign', data);
export const bulkDeleteWorkOrders = (data) => api.post('/api/work-orders/bulk/delete', data);

export const getWorkOrderHistory = (entityType, entityId, entityName, config) => {
  const query = new URLSearchParams();
  if (entityType) query.set('entity_type', entityType);
  if (entityId !== undefined && entityId !== null && entityId !== '') query.set('entity_id', String(entityId));
  if (entityName) query.set('entity_name', entityName);
  query.set('_t', String(Date.now()));
  return api.get(`/api/work-orders/history?${query.toString()}`, config);
};

// Preventive Maintenance Schedules
export const getPMSchedules = (config) => api.get('/api/pm-schedules', config);
export const getPMSchedule = (id, config) => api.get(`/api/pm-schedules/${id}`, config);
export const getPMCalendar = (start, end, config) => api.get('/api/pm-schedules/calendar', {
  ...config,
  params: { ...(config?.params || {}), start, end },
});
export const previewPMSchedule = (data) => api.post('/api/pm-schedules/preview', data);
export const createPMSchedule = (data) => api.post('/api/pm-schedules', data);
export const updatePMSchedule = (id, data) => api.put(`/api/pm-schedules/${id}`, data);
export const deletePMSchedule = (id) => api.delete(`/api/pm-schedules/${id}`);
export const triggerPMSchedule = (id) => api.post(`/api/pm-schedules/${id}/trigger`);
export const checkDuePMSchedules = () => api.post('/api/pm-schedules/check-due');

// Task Templates & Sheets
export const getTasks = (params = {}, config = {}) => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category && params.category !== 'all') query.set('category', params.category);
  if (params.is_active !== undefined && params.is_active !== null) query.set('is_active', String(params.is_active));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return api.get(`/api/tasks${qs ? `?${qs}` : ''}`, config);
};
export const getTask = (id, config) => api.get(`/api/tasks/${id}`, config);
export const createTask = (data) => api.post('/api/tasks', data);
export const updateTask = (id, data) => api.put(`/api/tasks/${id}`, data);
export const deleteTask = (id) => api.delete(`/api/tasks/${id}`);
export const getTaskCategories = (params = {}, config = {}) => api.get('/api/tasks/categories', { ...config, params });
export const createTaskCategory = (data) => api.post('/api/tasks/categories', data);
export const updateTaskCategory = (name, data) => api.put(`/api/tasks/categories/${encodeURIComponent(name)}`, data);
export const getTaskTypes = (config) => api.get('/api/task-types', config);
export const createTaskType = (data) => api.post('/api/task-types', data);
export const updateTaskType = (id, data) => api.put(`/api/task-types/${id}`, data);

// Legacy Tickets (kept for compatibility)
export const getAllTickets = (config) => api.get('/api/tickets', config);
export const createTicket = (ticketData) => api.post('/api/tickets', ticketData);
export const updateTicket = (id, ticketData) => api.put(`/api/tickets/${id}`, ticketData);
export const deleteTicket = (id) => api.delete(`/api/tickets/${id}`);
