import  { useState, useEffect } from 'react';
import {
  X, Trash2, AlertTriangle, RefreshCw, CheckCircle2, ShieldAlert
} from 'lucide-react';
import { bulkDeleteWorkOrders, getErrorMessage } from '../api';

export default function BulkDeleteWorkOrdersModal({
  isOpen,
  onClose,
  selectedWorkOrders = [],
  onSuccess
}) {
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

  const [previousOpen, setPreviousOpen] = useState(isOpen);
  if (previousOpen !== isOpen) {
    setPreviousOpen(isOpen);
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsSubmitting(false);
    }
  }

  if (!isOpen || selectedWorkOrders.length === 0) return null;

  const handleDelete = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    const targetIds = selectedWorkOrders.map(w => w.id);

    try {
      const res = await bulkDeleteWorkOrders({ ids: targetIds });
      setSuccessMsg(`Successfully deleted ${res.data?.count || targetIds.length} work order(s).`);

      if (onSuccess) {
        onSuccess(res.data);
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Bulk delete error:', err);
      setErrorMsg(getErrorMessage(err, 'Failed to delete selected work orders.'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose}>
      <div
        className="modal-card modal-md glass-panel"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '520px', border: '1px solid rgba(239, 68, 68, 0.4)' }}
      >
        {/* Header */}
        <div className="modal-card-header flex-between" style={{ borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <div className="flex items-center gap-sm">
            <div className="icon-box-danger" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '8px', borderRadius: '8px' }}>
              <Trash2 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <h2 className="text-base font-bold m-0 text-primary">Delete Work Orders</h2>
                <span className="badge badge-danger text-xs font-semibold px-xs py-0.5">
                  {selectedWorkOrders.length} {selectedWorkOrders.length === 1 ? 'order' : 'orders'}
                </span>
              </div>
              <div className="text-xs text-muted">
                Permanent removal of selected work order tickets
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="alert-box-danger-left m-md flex items-center gap-sm p-sm text-xs">
            <AlertTriangle size={15} color="var(--danger-color)" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="alert-box-success-left m-md flex items-center gap-sm p-sm text-xs">
            <CheckCircle2 size={15} color="var(--success-color)" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Warning Banner */}
        <div style={{
          margin: '1rem 1.25rem 0.5rem',
          padding: '0.75rem',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          gap: '0.65rem'
        }}>
          <ShieldAlert size={20} color="var(--danger-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div className="text-xs text-primary" style={{ lineHeight: 1.4 }}>
            <strong>Warning:</strong> You are about to permanently delete{' '}
            <strong className="text-danger">{selectedWorkOrders.length} work order(s)</strong>.
            This action cannot be undone and will remove associated labor logs and comments.
          </div>
        </div>

        {/* Selected Orders List */}
        <div style={{ padding: '0.5rem 1.25rem 1rem' }}>
          <div className="text-xs font-semibold text-muted mb-xs">Selected work orders to delete:</div>
          <div style={{
            maxHeight: '160px',
            overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.35rem 0.5rem'
          }}>
            {selectedWorkOrders.map(wo => (
              <div
                key={wo.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '0.35rem 0.45rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.75rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                  <span className="font-bold text-primary">{wo.order_number}</span>
                  <span className="text-muted truncate" style={{ maxWidth: '240px' }}>{wo.title}</span>
                </div>
                <span style={{
                  fontSize: '0.66rem',
                  padding: '0.05rem 0.35rem',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  flexShrink: 0
                }}>
                  {wo.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-card-footer flex-between p-md" style={{ borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm inline-flex items-center gap-xs font-bold"
            onClick={handleDelete}
            disabled={isSubmitting}
            style={{ minWidth: '140px', justifyContent: 'center' }}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={13} className="spinning" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 size={13} />
                <span>Delete ({selectedWorkOrders.length}) Orders</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
