import { useState, useEffect, useId } from 'react';
import {
  X, UserPlus, Users, CheckCircle2,
  ShieldAlert, RefreshCw
} from 'lucide-react';
import { bulkAssignWorkOrders, getAssignableUsers, getTrades, getErrorMessage } from '../api';
import EntitySearchSelector from './EntitySearchSelector';
import './WorkOrderEditModal.css';
import './CloseWorkOrderModal.css';

const PRIORITY_OPTIONS = [
  { value: '', label: '(Keep current priority)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Critical / Urgent' }
];

const STATUS_OPTIONS = [
  { value: '', label: '(Keep current status / Auto)' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' }
];

export default function BulkAssignWorkOrdersModal({
  isOpen = true,
  onClose,
  selectedWorkOrders = [],
  onSuccess
}) {
  const modalTitleId = useId();
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [availableTrades, setAvailableTrades] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [unassignAll, setUnassignAll] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dispatchNote, setDispatchNote] = useState('');

  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // ESC key listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting]);

  // Load assignable users & trades
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getAssignableUsers().catch(() => ({ data: [] })),
      getTrades().catch(() => ({ data: [] }))
    ]).then(([usersRes, tradesRes]) => {
      if (!isMounted) return;
      const usersList = usersRes.data || [];
      usersList.sort((a, b) => {
        const nameA = (a.full_name || a.username || '').toLowerCase();
        const nameB = (b.full_name || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
      });
      setAssignableUsers(usersList);
      setAvailableTrades(tradesRes.data || []);
    }).finally(() => {
      if (isMounted) setIsLoadingMeta(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!isOpen || selectedWorkOrders.length === 0) return null;

  const toggleUser = (userId) => {
    if (unassignAll) setUnassignAll(false);
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleUnassignAllToggle = () => {
    if (!unassignAll) {
      setUnassignAll(true);
      setSelectedUserIds([]);
    } else {
      setUnassignAll(false);
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (selectedWorkOrders.length === 0) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const targetIds = selectedWorkOrders.map(w => (typeof w === 'object' ? w.id : w)).filter(Boolean);

    // Prepare payload
    const payload = {
      ids: targetIds
    };

    if (unassignAll) {
      payload.assigned_user_ids = [];
    } else if (selectedUserIds.length > 0) {
      payload.assigned_user_ids = selectedUserIds;
    }

    if (selectedTrade) {
      payload.trade = selectedTrade === '__CLEAR__' ? '' : selectedTrade;
    }

    if (selectedPriority) {
      payload.priority = selectedPriority;
    }

    if (selectedStatus) {
      payload.status = selectedStatus;
    }

    if (dueDate) {
      payload.due_date = new Date(dueDate).toISOString();
    }

    if (dispatchNote && dispatchNote.trim()) {
      payload.dispatch_note = dispatchNote.trim();
    }

    try {
      const res = await bulkAssignWorkOrders(payload);
      setSuccessMsg(`Successfully updated ${res.data?.count || targetIds.length} work order(s).`);

      if (onSuccess) {
        onSuccess(res.data);
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Bulk assign error:', err);
      setErrorMsg(getErrorMessage(err, 'Failed to update selected work orders.'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay modal-backdrop-dark wo-edit-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-lg glass-panel wo-edit-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
      >
        {/* Header */}
        <div className="modal-card-header wo-edit-modal-header">
          <div className="wo-edit-header-title">
            <div className="icon-box-primary" aria-hidden="true">
              <UserPlus size={18} />
            </div>
            <div>
              <div className="wo-edit-title-row">
                <h2 id={modalTitleId}>Bulk Assign Work Orders</h2>
                <span className="badge badge-primary">
                  {selectedWorkOrders.length} {selectedWorkOrders.length === 1 ? 'order' : 'orders'}
                </span>
              </div>
              <p>Assign technicians and update dispatch settings across selected orders.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-sm"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close bulk assign dialog"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="wo-edit-form-shell">
          <div className="modal-card-body wo-edit-form-body">
            {/* Target Orders Summary Card */}
            <div className="info-card-subtle">
              <div className="flex justify-between items-center gap-sm mb-xs">
                <span className="text-xs font-semibold text-secondary">Target Work Orders</span>
                <span className="badge badge-secondary">{selectedWorkOrders.length} selected</span>
              </div>
              <div className="close-wo-bulk-chips">
                {selectedWorkOrders.slice(0, 10).map(wo => (
                  <span key={wo.id} className="tag-pill-blue close-wo-bulk-pill font-bold">
                    {wo.order_number || `WO-${wo.id}`}
                  </span>
                ))}
                {selectedWorkOrders.length > 10 && (
                  <span className="close-wo-bulk-more text-xs text-muted font-semibold">
                    +{selectedWorkOrders.length - 10} more
                  </span>
                )}
              </div>
            </div>

            {/* Error Notification */}
            {errorMsg && (
              <div className="wo-edit-error" role="alert">
                <ShieldAlert size={16} aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Success Notification */}
            {successMsg && (
              <div className="alert-box-success flex items-center gap-sm p-sm rounded-lg" style={{ background: 'var(--success-subtle)', border: '1px solid var(--success-border)', color: '#34d399' }}>
                <CheckCircle2 size={18} className="flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Technician Assignment Section */}
            <section className="wo-edit-section" aria-labelledby="bulk-assign-technicians-heading">
              <div className="wo-edit-section-heading">
                <div className="wo-edit-section-icon" aria-hidden="true">
                  <Users size={15} />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <h3 id="bulk-assign-technicians-heading">Technician Assignment</h3>
                    <button
                      type="button"
                      className={`btn btn-xs ${unassignAll ? 'btn-danger' : 'btn-ghost'}`}
                      onClick={handleUnassignAllToggle}
                    >
                      {unassignAll ? '✓ Will Unassign All' : 'Unassign All Techs'}
                    </button>
                  </div>
                  <p>Assign staff or unassign all existing technicians on selected orders.</p>
                </div>
              </div>

              {isLoadingMeta ? (
                <div className="flex items-center gap-xs text-xs text-muted py-sm">
                  <RefreshCw size={12} className="spinning" />
                  <span>Loading available technicians...</span>
                </div>
              ) : unassignAll ? (
                <div className="alert-box-danger-left p-sm text-xs rounded-md">
                  All technicians currently assigned to the selected work orders will be removed upon saving.
                </div>
              ) : (
                <EntitySearchSelector
                  entityType="technician"
                  label=""
                  items={assignableUsers}
                  selectedIds={selectedUserIds}
                  onToggle={toggleUser}
                  onClearAll={() => setSelectedUserIds([])}
                  placeholder="Search staff and technicians to assign..."
                  disabled={isSubmitting}
                />
              )}

              {selectedUserIds.length === 0 && !unassignAll && !isLoadingMeta && (
                <p className="text-2xs text-muted m-0">
                  * If no technicians are selected, existing technician assignments on the work orders will remain unchanged.
                </p>
              )}
            </section>

            {/* Classification & Schedule Grid */}
            <div className="wo-edit-metadata-grid">
              <div className="wo-edit-field">
                <label htmlFor="bulk-assign-trade">
                  <span>Assigned trade</span>
                  <span className="wo-edit-label-meta">Optional</span>
                </label>
                <select
                  id="bulk-assign-trade"
                  className="input-field"
                  value={selectedTrade}
                  onChange={e => setSelectedTrade(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="">(Keep current trade)</option>
                  <option value="__CLEAR__">— Clear Trade —</option>
                  {availableTrades.map(t => (
                    <option key={t.id || t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="wo-edit-field">
                <label htmlFor="bulk-assign-priority">
                  <span>Priority</span>
                  <span className="wo-edit-label-meta">Optional</span>
                </label>
                <select
                  id="bulk-assign-priority"
                  className="input-field"
                  value={selectedPriority}
                  onChange={e => setSelectedPriority(e.target.value)}
                  disabled={isSubmitting}
                >
                  {PRIORITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="wo-edit-field">
                <label htmlFor="bulk-assign-status">
                  <span>Status override</span>
                  <span className="wo-edit-label-meta">Optional</span>
                </label>
                <select
                  id="bulk-assign-status"
                  className="input-field"
                  value={selectedStatus}
                  onChange={e => setSelectedStatus(e.target.value)}
                  disabled={isSubmitting}
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="wo-edit-field">
                <label htmlFor="bulk-assign-due">
                  <span>Due date</span>
                  <span className="wo-edit-label-meta">Optional</span>
                </label>
                <input
                  id="bulk-assign-due"
                  type="date"
                  className="input-field"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Dispatch Note */}
            <div className="wo-edit-field">
              <label htmlFor="bulk-assign-dispatch-note">
                <span>Internal dispatch note / comment</span>
                <span className="wo-edit-label-meta">Optional</span>
              </label>
              <textarea
                id="bulk-assign-dispatch-note"
                className="input-field wo-edit-description"
                rows={3}
                placeholder="Add an internal note or dispatch comment to all selected work orders..."
                value={dispatchNote}
                onChange={e => setDispatchNote(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="modal-card-footer wo-edit-modal-footer">
            <span className="wo-edit-footer-note">
              {successMsg || `Changes will apply to ${selectedWorkOrders.length} work orders.`}
            </span>
            <div className="wo-edit-footer-actions">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary btn-sm"
                disabled={isSubmitting}
              >
                {successMsg ? "Done" : "Cancel"}
              </button>
              {!successMsg && (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary btn-sm gap-xs"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={14} className="spinning" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={14} />
                      <span>Update ({selectedWorkOrders.length}) Orders</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
