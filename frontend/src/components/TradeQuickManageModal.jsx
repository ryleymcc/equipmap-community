import  { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Edit2, Trash2, Wrench, AlertTriangle,
  Check, User as UserIcon, Calendar, CheckCircle2, Search, ArrowLeft
} from 'lucide-react';
import {
  getTradesSummary, createTrade, updateTrade, deleteTrade, getErrorMessage
} from '../api';

const COLOR_PRESETS = [
  '#3b82f6', '#10b981', '#a855f7', '#f59e0b',
  '#06b6d4', '#f43f5e', '#ec4899', '#64748b'
];

export default function TradeQuickManageModal({
  isOpen,
  onClose,
  onTradeCreated,
  onTradeUpdated,
  onTradeDeleted,
  initialTradeToEdit = null
}) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Mode: 'list' | 'create' | 'edit' | 'delete'
  const [viewMode, setViewMode] = useState('list');

  // Create form state
  const [newTradeName, setNewTradeName] = useState('');
  const [newTradeDescription, setNewTradeDescription] = useState('');
  const [newTradeColor, setNewTradeColor] = useState('#3b82f6');
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editingTrade, setEditingTrade] = useState(null);
  const [editTradeName, setEditTradeName] = useState('');
  const [editTradeDescription, setEditTradeDescription] = useState('');
  const [editTradeColor, setEditTradeColor] = useState('#3b82f6');

  // Delete state
  const [deletingTrade, setDeletingTrade] = useState(null);
  const [deleteReassignTo, setDeleteReassignTo] = useState('');

  const fetchTrades = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getTradesSummary();
      setTrades(res.data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load trades.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    // Begin loading and resetting this modal with its asynchronous request.
    void Promise.resolve().then(() => {
      fetchTrades();
      if (initialTradeToEdit) {
      startEditTrade({ name: initialTradeToEdit });
    } else {
      setViewMode('list');
    }
      setError(null);
    });
  }, [isOpen, initialTradeToEdit]);

  const handleCreateTrade = async (e) => {
    e.preventDefault();
    if (!newTradeName.trim()) {
      setError('Trade name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const res = await createTrade({
        name: newTradeName.trim(),
        description: newTradeDescription.trim() || null,
        color: newTradeColor || '#3b82f6'
      });
      const createdName = res.data?.name || newTradeName.trim();
      await fetchTrades();
      if (onTradeCreated) {
        onTradeCreated(createdName);
      }
      setViewMode('list');
      setNewTradeName('');
      setNewTradeDescription('');
      setNewTradeColor('#3b82f6');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create trade.'));
    } finally {
      setSaving(false);
    }
  };

  function startEditTrade(tradeItem) {
    const fullTrade = trades.find(t => t.name.toLowerCase() === tradeItem.name.toLowerCase()) || tradeItem;
    setEditingTrade(fullTrade);
    setEditTradeName(fullTrade.name);
    setEditTradeDescription(fullTrade.description || '');
    setEditTradeColor(fullTrade.color || '#3b82f6');
    setError(null);
    setViewMode('edit');
  };

  const handleUpdateTrade = async (e) => {
    e.preventDefault();
    if (!editTradeName.trim()) {
      setError('Trade name is required.');
      return;
    }

    const isRenaming = editTradeName.trim() !== editingTrade.name;
    if (isRenaming) {
      const affected = (editingTrade.user_count || 0) + (editingTrade.pm_schedule_count || 0) + (editingTrade.work_order_count || 0);
      if (affected > 0) {
        if (!window.confirm(`Renaming "${editingTrade.name}" to "${editTradeName.trim()}" will update ${editingTrade.user_count} technician(s), ${editingTrade.pm_schedule_count} PM schedule(s), and ${editingTrade.work_order_count} work order(s). Proceed?`)) {
          return;
        }
      }
    }

    try {
      setSaving(true);
      setError(null);
      const res = await updateTrade(editingTrade.name, {
        name: editTradeName.trim(),
        description: editTradeDescription.trim() || null,
        color: editTradeColor || '#3b82f6'
      });
      const updatedName = res.data?.name || editTradeName.trim();
      const oldName = editingTrade.name;
      await fetchTrades();
      if (onTradeUpdated) {
        onTradeUpdated(oldName, updatedName);
      }
      setViewMode('list');
      setEditingTrade(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update trade.'));
    } finally {
      setSaving(false);
    }
  };

  const startDeleteTrade = (tradeItem) => {
    setDeletingTrade(tradeItem);
    setDeleteReassignTo('');
    setError(null);
    setViewMode('delete');
  };

  const handleDeleteTrade = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      await deleteTrade(deletingTrade.name, {
        reassign_to: deleteReassignTo || null
      });
      const deletedName = deletingTrade.name;
      const reassigned = deleteReassignTo || null;
      await fetchTrades();
      if (onTradeDeleted) {
        onTradeDeleted(deletedName, reassigned);
      }
      setViewMode('list');
      setDeletingTrade(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete trade.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const filteredTrades = trades.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
  });

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose} style={{ zIndex: 1400 }}>
      <div
        className="modal-card modal-md glass-panel trade-quick-manage-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-card-header">
          <div className="flex items-center gap-xs">
            {viewMode !== 'list' && (
              <button
                type="button"
                className="btn btn-secondary btn-icon-xs mr-2xs"
                onClick={() => { setViewMode('list'); setError(null); }}
                title="Back to Trades List"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="icon-box-primary">
              <Wrench size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-primary m-0">
                {viewMode === 'list' && 'Trades Management'}
                {viewMode === 'create' && 'Add New Trade'}
                {viewMode === 'edit' && `Edit Trade: ${editingTrade?.name || ''}`}
                {viewMode === 'delete' && `Delete Trade: ${deletingTrade?.name || ''}`}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-xs">
            {viewMode === 'list' && (
              <button
                type="button"
                className="btn btn-primary btn-sm gap-xs"
                onClick={() => {
                  setError(null);
                  setNewTradeName('');
                  setNewTradeDescription('');
                  setNewTradeColor('#3b82f6');
                  setViewMode('create');
                }}
              >
                <Plus size={14} />
                <span>Add Trade</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-icon-xs text-muted hover:text-primary ml-xs"
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-card-body">
          {error && (
            <div className="alert-box-danger text-sm p-sm rounded-md mb-xs">
              {error}
            </div>
          )}

          {/* VIEW: LIST */}
          {viewMode === 'list' && (
            <div className="flex-column gap-sm">
              {/* Search Bar */}
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Search trades..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: '2.2rem', height: '36px', borderRadius: '8px', fontSize: '0.85rem' }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex-center p-xl">
                  <div className="loader">Loading trades...</div>
                </div>
              ) : filteredTrades.length === 0 ? (
                <div className="flex-column flex-center p-xl text-center" style={{ background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px dashed rgba(255, 255, 255, 0.1)' }}>
                  <Wrench size={30} className="text-muted mb-xs opacity-50" />
                  <div className="text-sm font-semibold text-foreground">No Trades Found</div>
                  <div className="text-2xs text-muted mt-2xs">
                    {searchQuery ? `No trades match "${searchQuery}"` : 'No trades registered yet.'}
                  </div>
                </div>
              ) : (
                <div className="flex-column gap-xs" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  {filteredTrades.map(t => (
                    <div
                      key={t.name}
                      className="p-sm rounded-lg flex-between items-center gap-sm"
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <div className="flex-column gap-2xs flex-1 min-w-0">
                        <div className="flex items-center gap-xs flex-wrap">
                          <span
                            className="permission-pill"
                            style={{
                              background: t.color ? `${t.color}20` : 'rgba(59, 130, 246, 0.15)',
                              color: t.color || '#3b82f6',
                              border: `1px solid ${t.color ? `${t.color}40` : 'rgba(59, 130, 246, 0.3)'}`,
                              fontWeight: 600,
                              fontSize: '0.78rem',
                              padding: '0.2rem 0.55rem'
                            }}
                          >
                            <Wrench size={11} />
                            <span>{t.name}</span>
                          </span>
                        </div>
                        {t.description && (
                          <div className="text-2xs text-muted truncate">{t.description}</div>
                        )}
                        <div className="flex items-center gap-xs flex-wrap mt-2xs">
                          <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                            <UserIcon size={10} />
                            <span>{t.user_count} Techs</span>
                          </span>
                          <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                            <Calendar size={10} />
                            <span>{t.pm_schedule_count} PMs</span>
                          </span>
                          <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                            <CheckCircle2 size={10} />
                            <span>{t.work_order_count} WOs</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-xs">
                        <button
                          type="button"
                          className="row-action-btn"
                          onClick={() => startEditTrade(t)}
                          title={`Edit ${t.name}`}
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="row-action-btn delete-btn"
                          onClick={() => startDeleteTrade(t)}
                          title={`Delete ${t.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW: CREATE */}
          {viewMode === 'create' && (
            <form onSubmit={handleCreateTrade} className="flex-column gap-md">
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Trade Name *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. HVAC, Medical Equipment"
                  value={newTradeName}
                  onChange={e => setNewTradeName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Description (Optional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Heating, ventilation & air conditioning services"
                  value={newTradeDescription}
                  onChange={e => setNewTradeDescription(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Badge Color</label>
                <div className="flex items-center gap-sm flex-wrap pt-2xs">
                  {COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTradeColor(color)}
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: color,
                        border: newTradeColor === color ? '2px solid white' : '2px solid transparent',
                        boxShadow: newTradeColor === color ? `0 0 8px ${color}` : 'none',
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setViewMode('list'); setError(null); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                  disabled={saving}
                >
                  <Plus size={14} />
                  <span>{saving ? 'Creating...' : 'Create Trade'}</span>
                </button>
              </div>
            </form>
          )}

          {/* VIEW: EDIT */}
          {viewMode === 'edit' && editingTrade && (
            <form onSubmit={handleUpdateTrade} className="flex-column gap-md">
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Trade Name *</label>
                <input
                  type="text"
                  className="input-field"
                  value={editTradeName}
                  onChange={e => setEditTradeName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {editTradeName.trim() !== editingTrade.name && (
                <div className="p-sm rounded-lg flex items-start gap-xs" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                  <AlertTriangle size={16} color="#fbbf24" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div className="text-xs text-secondary leading-normal">
                    <strong>Cascading Update:</strong> Renaming this trade will automatically update all <strong className="text-foreground">{editingTrade.user_count || 0}</strong> technicians, <strong className="text-foreground">{editingTrade.pm_schedule_count || 0}</strong> PM schedules, and <strong className="text-foreground">{editingTrade.work_order_count || 0}</strong> work orders.
                  </div>
                </div>
              )}

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Description</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Optional description"
                  value={editTradeDescription}
                  onChange={e => setEditTradeDescription(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Badge Color</label>
                <div className="flex items-center gap-sm flex-wrap pt-2xs">
                  {COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditTradeColor(color)}
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: color,
                        border: editTradeColor === color ? '2px solid white' : '2px solid transparent',
                        boxShadow: editTradeColor === color ? `0 0 8px ${color}` : 'none',
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setViewMode('list'); setError(null); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                  disabled={saving}
                >
                  <Check size={14} />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          )}

          {/* VIEW: DELETE */}
          {viewMode === 'delete' && deletingTrade && (
            <form onSubmit={handleDeleteTrade} className="flex-column gap-md">
              <div className="p-sm rounded-lg flex items-start gap-xs" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                <AlertTriangle size={16} color="#f87171" style={{ marginTop: '2px', flexShrink: 0 }} />
                <div className="text-xs text-secondary leading-normal">
                  This trade is currently linked to <strong className="text-foreground">{deletingTrade.user_count || 0}</strong> technician(s), <strong className="text-foreground">{deletingTrade.pm_schedule_count || 0}</strong> PM schedule(s), and <strong className="text-foreground">{deletingTrade.work_order_count || 0}</strong> work order(s).
                </div>
              </div>

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Reassign Linked Items To:</label>
                <select
                  className="input-field"
                  value={deleteReassignTo}
                  onChange={e => setDeleteReassignTo(e.target.value)}
                >
                  <option value="">— None (Clear trade from all linked records) —</option>
                  {trades
                    .filter(t => t.name !== deletingTrade.name)
                    .map(t => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))
                  }
                </select>
                <div className="text-2xs text-muted mt-2xs">
                  {deleteReassignTo
                    ? `All linked technicians and schedules will be updated to "${deleteReassignTo}".`
                    : 'All linked technicians and schedules will have their trade cleared (set to empty).'}
                </div>
              </div>

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setViewMode('list'); setError(null); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger btn-sm gap-xs"
                  disabled={saving}
                >
                  <Trash2 size={14} />
                  <span>{saving ? 'Deleting...' : 'Confirm Delete'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
