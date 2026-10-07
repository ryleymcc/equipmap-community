import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getAuditLogs, undoAction } from '../api';
import {
  History as HistoryIcon, Building, Map as MapIcon, Package, DoorOpen,
  Menu, Info, RotateCcw, RefreshCw, User, X
} from 'lucide-react';
import DashboardLeftDrawer from '../components/DashboardLeftDrawer';
import PendingChatGPTChanges from '../components/PendingChatGPTChanges';

export default function AuditHistory() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isEditor, canUndoAllAuditLogs, loading } = useAuth();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUndoLoading, setIsUndoLoading] = useState(null); // ID of log being undid
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [pendingRefresh, setPendingRefresh] = useState(0);

  const canUndoLog = (log) => {
    if (log.action === 'undo') return false;
    if (isAdmin || canUndoAllAuditLogs) return true;
    if (log.user_id && user?.id) return log.user_id === user.id;
    if (log.username && user?.username) return log.username === user.username;
    return false;
  };

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getAuditLogs();
      setLogs(res.data);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !isEditor) {
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash
          },
          originalFrom: location.state?.from ? {
            pathname: location.state.from.pathname,
            search: location.state.from.search,
            hash: location.state.from.hash
          } : undefined,
          requiredRole: 'editor'
        }
      });
    }
  }, [loading, isEditor, navigate, location]);

  useEffect(() => {
    if (isEditor) queueMicrotask(loadLogs);
  }, [isEditor, loadLogs]);

  const handleUndo = async (logId) => {
    if (!window.confirm('Are you sure you want to undo this action?')) return;

    try {
      setIsUndoLoading(logId);
      await undoAction(logId);
      await loadLogs();
      alert('Action undid successfully');
    } catch (error) {
      console.error('Failed to undo action:', error);
      alert('Failed to undo action: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsUndoLoading(null);
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'create': return '#10b981';
      case 'update': return '#3b82f6';
      case 'delete': return '#ef4444';
      case 'undo': return '#a855f7';
      default: return 'var(--text-secondary)';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'site': return <Building size={16} />;
      case 'floorplan': return <MapIcon size={16} />;
      case 'room': return <DoorOpen size={16} />;
      case 'equipment': return <Package size={16} />;
      default: return <Info size={16} />;
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading || !isEditor) return null;

  return (
    <div className="app-layout">
      <DashboardLeftDrawer
        isOpen={isLeftDrawerOpen}
        onClose={() => setIsLeftDrawerOpen(false)}
        activeView="audit-log"
      />

      <div className="main-content">
        <header className="app-header dashboard-header">
          <button className="trigger-btn" onClick={() => setIsLeftDrawerOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="items-center gap-md ml-md flex-1">
            <HistoryIcon size={24} color="var(--primary-color)" />
            <h1 className="text-lg font-semibold m-0">Audit History</h1>
          </div>
          <button
            className="trigger-btn"
            onClick={() => { loadLogs(); setPendingRefresh((value) => value + 1); }}
            title="Refresh Logs"
          >
            <RefreshCw size={20} className={isLoading ? 'spinning' : ''} />
          </button>
        </header>

        <div className="list-view-container">
          <PendingChatGPTChanges refreshKey={pendingRefresh} onChanged={loadLogs} />
          {isLoading ? (
            <div className="flex-center p-2xl">
              <div className="loader">Loading history...</div>
            </div>
          ) : (
            <div className="list-table-wrapper">
              <table className="list-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Message</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="list-empty">
                          <HistoryIcon size={48} className="list-empty-icon" />
                          <p>No audit logs found</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    logs.map(log => (
                      <tr key={log.id}>
                        <td className="nowrap">{formatDate(log.timestamp)}</td>
                        <td>
                          <div className="items-center gap-xs text-sm" style={{ whiteSpace: 'nowrap' }}>
                            <User size={14} style={{ color: 'var(--text-secondary)' }} />
                            <span className="font-medium">{log.user_full_name || log.username || 'System'}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{
                            color: getActionColor(log.action),
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            fontSize: '0.75rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            backgroundColor: `${getActionColor(log.action)}20`
                          }}>
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <div className="items-center gap-sm">
                            {getTypeIcon(log.target_type)}
                            <span style={{ textTransform: 'capitalize' }}>{log.target_type}</span>
                          </div>
                        </td>
                        <td>{log.target_name || (log.target_id ? `ID: ${log.target_id}` : '-')}</td>
                        <td>{log.message}</td>
                        <td>
                          <div className="flex-row gap-xs items-center">
                            {(log.old_values || log.new_values) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-card-action"
                                onClick={() => setSelectedLog(log)}
                              >
                                <span>Details</span>
                              </button>
                            )}
                            {log.action !== 'undo' && canUndoLog(log) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-card-action gap-xs"
                                onClick={() => handleUndo(log.id)}
                                disabled={isUndoLoading === log.id}
                              >
                                <RotateCcw size={13} className="flex-shrink-0" />
                                <span>{isUndoLoading === log.id ? '...' : 'Undo'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setSelectedLog(null)} style={{ zIndex: 1200 }}>
          <div className="modal-card modal-lg glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Info size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Change Details</h2>
                  <div className="text-xs text-muted">Audit log record #{selectedLog.id}</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setSelectedLog(null)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-card-body">
              <div className="flex items-center justify-between gap-sm mb-md p-sm rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div>
                  <div className="text-xs text-muted">Performed By</div>
                  <div className="flex items-center gap-xs mt-2xs">
                    <User size={14} className="text-primary" />
                    <span className="font-semibold text-sm text-foreground">{selectedLog.user_full_name || selectedLog.username || 'System'}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">Action & Target</div>
                  <div className="flex items-center gap-xs mt-2xs justify-end">
                    <span style={{ color: getActionColor(selectedLog.action), fontWeight: 700, textTransform: 'uppercase', fontSize: '0.8rem' }}>
                      {selectedLog.action}
                    </span>
                    <span className="text-xs text-foreground font-medium">• {selectedLog.target_type}: {selectedLog.target_name}</span>
                  </div>
                </div>
              </div>

              {selectedLog.old_values && (
                <div className="mb-md">
                  <h3 className="text-xs font-semibold text-danger mb-xs flex items-center gap-xs">
                    <span>Old Values</span>
                  </h3>
                  <pre className="code-preview-box">
                    {JSON.stringify(selectedLog.old_values, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.new_values && (
                <div className="mb-md">
                  <h3 className="text-xs font-semibold text-success mb-xs flex items-center gap-xs">
                    <span>New Values</span>
                  </h3>
                  <pre className="code-preview-box">
                    {JSON.stringify(selectedLog.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="modal-card-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedLog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
