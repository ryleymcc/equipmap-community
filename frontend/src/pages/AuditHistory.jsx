import SortableTableHeader from '../components/SortableTableHeader';
import TablePagination from '../components/TablePagination';
import DataManager from '../components/DataManager';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  const isDataManager = location.pathname === '/audit-log/data';
  const { user, isAdmin, isEditor, canUndoAllAuditLogs, loading } = useAuth();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isUndoLoading, setIsUndoLoading] = useState(null); // ID of log being undid
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [pendingRefresh, setPendingRefresh] = useState(0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const sortColumn = field => {
    setSortDirection(sortBy === field ? (sortDirection === 'asc' ? 'desc' : 'asc') : field === 'name' ? 'asc' : 'desc');
    setSortBy(field);
    setPage(1);
  };
  const sortedLogs = useMemo(() => [...logs].sort((a, b) => {
    const comparison = sortBy === 'name'
      ? (a.target_name || '').localeCompare(b.target_name || '', undefined, { numeric: true, sensitivity: 'base' })
      : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return (sortDirection === 'asc' ? 1 : -1) * comparison || b.id - a.id;
  }), [logs, sortBy, sortDirection]);
  const currentPage = pageSize === 'all' ? 1 : Math.min(page, Math.max(1, Math.ceil(logs.length / pageSize)));
  const visibleLogs = pageSize === 'all' ? sortedLogs : sortedLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const canUndoLog = (log) => {
    if (log.undo_unavailable_reason || log.action === 'undo' || log.action === 'cleanup') return false;
    if (isAdmin || canUndoAllAuditLogs) return true;
    if (log.user_id && user?.id) return log.user_id === user.id;
    if (log.username && user?.username) return log.username === user.username;
    return false;
  };

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError('');
      const res = await getAuditLogs();
      setLogs(res.data);
      setPage(1);
    } catch (error) {
      setLogs([]);
      setSelectedLog(null);
      setLoadError([401, 403].includes(error.response?.status)
        ? 'You do not have permission to view audit history.'
        : 'Could not load audit history. Check your connection and refresh.');
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
    if (isEditor && !isDataManager) queueMicrotask(loadLogs);
  }, [isEditor, isDataManager, loadLogs]);

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
          <button className="trigger-btn" aria-label="Open navigation" title="Open navigation" onClick={() => setIsLeftDrawerOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="items-center gap-md ml-md flex-1">
            <HistoryIcon size={24} color="var(--primary-color)" />
            <h1 className="text-lg font-semibold m-0">{isDataManager ? 'Data manager' : 'Audit History'}</h1>
          </div>
          {!isDataManager && <button
            className="trigger-btn"
            onClick={() => { loadLogs(); setPendingRefresh((value) => value + 1); }}
            title="Refresh Logs"
          >
            <RefreshCw size={20} className={isLoading ? 'spinning' : ''} />
          </button>}
        </header>

        <div className="list-view-container">
          <nav className="data-manager-nav" aria-label="Audit dashboard">
            <Link className="btn btn-secondary" to="/audit-log" aria-current={!isDataManager ? 'page' : undefined}>Audit history</Link>
            {isAdmin && <Link className="btn btn-secondary" to="/audit-log/data" aria-current={isDataManager ? 'page' : undefined}>Data manager</Link>}
          </nav>
          {isDataManager ? (isAdmin ? <DataManager /> : <p role="alert">Only admins can manage upload storage.</p>) : <>
          <PendingChatGPTChanges refreshKey={pendingRefresh} onChanged={loadLogs} />
          {isLoading ? (
            <div className="flex-center p-2xl">
              <div className="loader">Loading history...</div>
            </div>
          ) : loadError ? (
            <p className="list-empty" role="alert">{loadError}</p>
          ) : (
            <div className="list-table-wrapper">
              <table className="list-table">
                <thead>
                  <tr>
                    <SortableTableHeader field="date" sortBy={sortBy} direction={sortDirection} onSort={sortColumn}>Timestamp</SortableTableHeader>
                    <th>User</th>
                    <th>Action</th>
                    <th>Type</th>
                    <SortableTableHeader field="name" sortBy={sortBy} direction={sortDirection} onSort={sortColumn}>Target</SortableTableHeader>
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
                    visibleLogs.map(log => (
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
                          <div className="flex-row flex-wrap gap-xs items-center">
                            {(log.old_values || log.new_values) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm flex-shrink-0"
                                onClick={() => setSelectedLog(log)}
                              >
                                <span>Details</span>
                              </button>
                            )}
                            {log.undo_unavailable_reason && <span className="text-sm text-secondary" title={log.undo_unavailable_reason}>Undo unavailable · required upload deleted</span>}
                            {log.action !== 'undo' && canUndoLog(log) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm flex-shrink-0 gap-xs"
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
          {!isLoading && <TablePagination total={logs.length} page={currentPage} pageSize={pageSize}
            onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />}
          </>}
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
