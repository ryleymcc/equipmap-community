import { useState, useEffect, useRef } from 'react';
import {
  X, CheckCircle2, Clock, RefreshCw, AlertCircle,
  Plus, Minus, Check, Calendar
} from 'lucide-react';
import { closeWorkOrder, bulkCloseWorkOrders, getErrorMessage } from '../api';
import './CloseWorkOrderModal.css';
import useDialogFocus from '../hooks/useDialogFocus';

const HOUR_PRESETS = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 8.0];

const getLocalDateTimeString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export default function CloseWorkOrderModal({
  workOrder,
  workOrders,
  selectedWorkOrders,
  isOpen = true,
  onClose,
  onSuccess
}) {
  const rawList = workOrders || selectedWorkOrders;
  const isBulk = Boolean(rawList);
  const targetOrders = Array.isArray(rawList)
    ? rawList
    : (workOrder ? [workOrder] : []);

  const [hours, setHours] = useState(() => (isBulk ? 0.0 : 1.0));
  const [notes, setNotes] = useState("");
  const [finishDate, setFinishDate] = useState(getLocalDateTimeString);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, isOpen && targetOrders.length > 0);

  // ESC key listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting]);

  if (!isOpen || targetOrders.length === 0) return null;

  const handleAdjustHours = (delta) => {
    setHours(prev => {
      const current = parseFloat(prev) || 0;
      const val = Math.max(0.0, Math.min(24.0, Math.round((current + delta) * 100) / 100));
      return val;
    });
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (targetOrders.length === 0) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const numHours = parseFloat(hours) || 0;
    const notesTrimmed = notes.trim() || undefined;
    const completedAtIso = finishDate ? new Date(finishDate).toISOString() : undefined;

    try {
      if (isBulk) {
        const targetIds = targetOrders.map(w => (typeof w === 'object' ? w.id : w)).filter(Boolean);
        const res = await bulkCloseWorkOrders({
          ids: targetIds,
          hours: numHours > 0 ? numHours : undefined,
          completion_notes: notesTrimmed,
          completed_at: completedAtIso
        });

        setSuccessMsg(`Successfully marked ${res.data?.count || targetIds.length} work order(s) as Completed.`);
        if (onSuccess) {
          onSuccess(res.data);
        }
      } else {
        const singleOrder = targetOrders[0];
        const res = await closeWorkOrder(singleOrder.id, {
          hours: numHours > 0 ? numHours : undefined,
          completion_notes: notesTrimmed,
          completed_at: completedAtIso
        });

        setSuccessMsg(`Work order ${singleOrder.order_number || singleOrder.id} marked as Completed.`);
        if (onSuccess) {
          onSuccess(res.data);
        }
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error("Error closing work order(s):", err);
      setErrorMsg(getErrorMessage(err, isBulk ? "Failed to close selected work orders." : "Failed to close work order."));
      setIsSubmitting(false);
    }
  };

  const singleOrder = !isBulk ? targetOrders[0] : null;

  return (
    <div
      className="modal-overlay modal-backdrop-dark"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal-card modal-md glass-panel close-wo-modal"
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-wo-dialog-title"
      >
        {/* Header */}
        <div className="modal-card-header">
          <div className="flex items-center gap-sm">
            <div className="icon-box-success">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <h2 id="close-wo-dialog-title" className="text-base font-bold m-0 text-primary">
                  {isBulk ? 'Bulk Complete Work Orders' : 'Complete Work Order'}
                </h2>
                {isBulk && (
                  <span className="badge badge-success">
                    {targetOrders.length} {targetOrders.length === 1 ? 'order' : 'orders'}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted">
                {isBulk
                  ? 'Record final labor and close out tickets in batch'
                  : 'Record final labor and close out ticket'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
            title="Close (Esc)"
            aria-label="Close dialog"
            disabled={isSubmitting}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="close-wo-form">
          <div className="modal-card-body">
            {/* Work Order Info Box / Target Orders Summary */}
            {isBulk ? (
              <div className="info-card-subtle">
                <div className="flex justify-between items-center gap-sm mb-xs">
                  <span className="text-xs font-semibold text-secondary">Selected Work Orders</span>
                  <span className="badge badge-secondary">{targetOrders.length} selected</span>
                </div>
                <div className="close-wo-bulk-chips">
                  {targetOrders.slice(0, 10).map(wo => (
                    <span key={wo.id} className="tag-pill-blue close-wo-bulk-pill font-bold">
                      {wo.order_number || `WO-${wo.id}`}
                    </span>
                  ))}
                  {targetOrders.length > 10 && (
                    <span className="close-wo-bulk-more text-xs text-muted font-semibold">
                      +{targetOrders.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="info-card-subtle">
                <div className="flex justify-between items-center gap-sm">
                  <span className="tag-pill-blue font-bold">
                    {singleOrder?.order_number || `WO-${singleOrder?.id}`}
                  </span>
                  <span className="badge badge-secondary">
                    {singleOrder?.category || 'General'}
                  </span>
                </div>

                <div className="text-sm font-semibold text-primary mt-xs close-wo-title-text">
                  {singleOrder?.title}
                </div>
              </div>
            )}

            {/* Success Notification */}
            {successMsg && (
              <div className="alert-box-success flex items-center gap-sm p-sm rounded-lg" style={{ background: 'var(--success-subtle)', border: '1px solid var(--success-border)', color: '#34d399' }}>
                <Check size={18} className="flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Error Notification */}
            {errorMsg && (
              <div className="alert-box-danger flex items-center gap-sm p-sm rounded-lg" style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger-border)', color: '#f87171' }}>
                <AlertCircle size={18} className="flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {!successMsg && (
              <>
                {/* Additional Labor Hours Entry */}
                <div className="input-group close-wo-labor-group">
                  <div className="flex justify-between items-center mb-xs">
                    <label className="flex items-center gap-xs m-0" htmlFor="close-wo-labor-hours">
                      <Clock size={13} className="text-success" />
                      <span>{isBulk ? 'Additional Labor Hours (Per Order)' : 'Additional Labor Hours (Optional)'}</span>
                    </label>
                    <span className="text-2xs text-muted">Optional</span>
                  </div>

                  {/* Input Stepper */}
                  <div className="close-wo-stepper">
                    <button
                      type="button"
                      onClick={() => handleAdjustHours(-0.5)}
                      className="btn btn-secondary close-wo-stepper-btn"
                      title="Decrease by 0.5 hr"
                      aria-label="Decrease labor hours by 0.5"
                      disabled={isSubmitting || parseFloat(hours) <= 0}
                    >
                      <Minus size={15} />
                    </button>

                    <input
                      id="close-wo-labor-hours"
                      type="number"
                      step="any"
                      min="0"
                      max="24"
                      value={hours}
                      onChange={e => setHours(e.target.value)}
                      className="number-input-stepper close-wo-stepper-input"
                      disabled={isSubmitting}
                      aria-label="Additional labor hours"
                    />

                    <button
                      type="button"
                      onClick={() => handleAdjustHours(0.5)}
                      className="btn btn-secondary close-wo-stepper-btn"
                      title="Increase by 0.5 hr"
                      aria-label="Increase labor hours by 0.5"
                      disabled={isSubmitting || parseFloat(hours) >= 24}
                    >
                      <Plus size={15} />
                    </button>
                  </div>

                  {/* Quick Presets */}
                  <div className="close-wo-presets">
                    {HOUR_PRESETS.map((pVal) => (
                      <button
                        key={pVal}
                        type="button"
                        onClick={() => setHours(pVal)}
                        className={`btn btn-2xs close-wo-preset-btn ${parseFloat(hours) === pVal ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={isSubmitting}
                      >
                        {pVal === 0 ? '0h' : `${pVal}h`}
                      </button>
                    ))}
                  </div>

                  {isBulk && (
                    <div className="text-2xs text-muted mt-xs">
                      * Labor hours entered will be recorded for each selected work order.
                    </div>
                  )}
                </div>

                {/* Completed Date & Time */}
                <div className="input-group">
                  <div className="flex justify-between items-center mb-xs">
                    <label className="flex items-center gap-xs m-0" htmlFor="close-wo-completed-date">
                      <Calendar size={13} className="text-primary" />
                      <span>Completed Date & Time</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setFinishDate(getLocalDateTimeString())}
                      className="btn btn-ghost btn-2xs text-primary"
                      disabled={isSubmitting}
                    >
                      Set to Now
                    </button>
                  </div>
                  <input
                    id="close-wo-completed-date"
                    type="datetime-local"
                    value={finishDate}
                    onChange={e => setFinishDate(e.target.value)}
                    className="input-field close-wo-date-input"
                    style={{ colorScheme: 'dark' }}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Completion Notes */}
                <div className="input-group">
                  <label htmlFor="close-wo-notes">
                    Completion Notes / Final Summary
                  </label>
                  <textarea
                    id="close-wo-notes"
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Describe resolution, replaced components, or notes for record..."
                    className="input-field close-wo-notes-input"
                    disabled={isSubmitting}
                  />
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="modal-card-footer">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn btn-secondary btn-sm"
            >
              {successMsg ? "Done" : "Cancel"}
            </button>

            {!successMsg && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-success btn-sm gap-xs"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={14} className="spinning" />
                    <span>{isBulk ? 'Closing...' : 'Completing...'}</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>{isBulk ? `Complete (${targetOrders.length}) Orders` : 'Complete Work Order'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
