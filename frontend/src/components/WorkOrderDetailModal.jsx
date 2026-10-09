import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Wrench, Clock, User, Calendar, MapPin, Building,
  CheckCircle2, AlertTriangle, MessageSquare, Send, Plus,
  Trash2, Edit3, ShieldAlert, Check, Copy,
  Phone, Mail, RefreshCw, Minus, Printer,
  ListChecks, CheckSquare, Globe, Network, Info
} from 'lucide-react';
import {
  getWorkOrder, updateWorkOrder, addWorkOrderLabor,
  updateWorkOrderLabor, deleteWorkOrderLabor,
  addWorkOrderComment, updateWorkOrderComment, deleteWorkOrderComment,
  deleteWorkOrder,
  getErrorMessage
} from '../api';
import WorkOrderTriageModal from './WorkOrderTriageModal';
import CloseWorkOrderModal from './CloseWorkOrderModal';
import WorkOrderPrintModal from './WorkOrderPrintModal';
import WorkOrderEditModal from './WorkOrderEditModal';
import { stripRepeatedWorkOrderTitle } from '../utils/workOrderDescription';
import useDialogFocus from '../hooks/useDialogFocus';

const LABOR_HOUR_PRESETS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 8.0];

export default function WorkOrderDetailModal(props) {
  if (!props.isOpen || !props.workOrder) return null;
  return <WorkOrderDetailModalContent {...props} />;
}

function WorkOrderDetailModalContent({
  workOrder: initialWorkOrder,
  onClose,
  onUpdated,
  onSelectMapLocation,
  currentUser
}) {
  const [wo, setWo] = useState(initialWorkOrder);
  const onCloseRef = useRef(onClose);
  const onUpdatedRef = useRef(onUpdated);
  const [copiedWoNumber, setCopiedWoNumber] = useState(false);

  // Sub-modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTriageModalOpen, setIsTriageModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, !isEditModalOpen && !isTriageModalOpen && !isCloseModalOpen && !isPrintModalOpen);

  // Labor Logging Form State
  const [laborHours, setLaborHours] = useState('1.0');
  const [laborComment, setLaborComment] = useState('');
  const [isLoggingLabor, setIsLoggingLabor] = useState(false);
  const [laborError, setLaborError] = useState(null);

  // Labor Entry Edit State
  const [editingLaborId, setEditingLaborId] = useState(null);
  const [editLaborHours, setEditLaborHours] = useState('');
  const [editLaborComment, setEditLaborComment] = useState('');
  const [isSavingLabor, setIsSavingLabor] = useState(false);

  // Comment Stream Form State
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentError, setCommentError] = useState(null);

  // Comment Edit State
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  // Telemetry copy / view states
  const [copiedIp, setCopiedIp] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showUserAgent, setShowUserAgent] = useState(false);

  const handleCopyIp = (ip, e) => {
    if (e) e.stopPropagation();
    if (!ip) return;
    navigator.clipboard.writeText(ip);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const canWrite = Boolean(currentUser && currentUser.role !== 'viewer');
  const isTriageUser = canWrite && Boolean(currentUser?.role === 'admin' || currentUser?.can_triage);
  const canDelete = canWrite && Boolean(currentUser?.role === 'admin' || currentUser?.role === 'editor' || isTriageUser);
  const isPendingTriage = wo.status === 'pending_triage';
  const isCompleted = wo.status === 'completed';

  useEffect(() => {
    onCloseRef.current = onClose;
    onUpdatedRef.current = onUpdated;
  }, [onClose, onUpdated]);

  // Keyboard shortcut (Escape to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isEditModalOpen && !isTriageModalOpen && !isCloseModalOpen && !isPrintModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isEditModalOpen, isTriageModalOpen, isCloseModalOpen, isPrintModalOpen]);

  // Refresh work order details
  const refreshWorkOrder = useCallback(async () => {
    try {
      const res = await getWorkOrder(initialWorkOrder.id);
      setWo(res.data);
      onUpdatedRef.current?.(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        onUpdatedRef.current?.(null, initialWorkOrder.id);
        onCloseRef.current?.();
        return;
      }
      console.error('Error refreshing work order:', err);
    }
  }, [initialWorkOrder.id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(refreshWorkOrder, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshWorkOrder]);

  const handleToggleChecklistStep = async (stepIndex) => {
    if (!wo.checklist_items || wo.checklist_items.length === 0) return;
    const updated = wo.checklist_items.map((item, idx) => {
      if (idx !== stepIndex) return item;
      if (typeof item === 'string') {
        return { id: `step-${idx}`, task: item, completed: true };
      }
      return { ...item, completed: !item.completed };
    });

    const optimisticWo = { ...wo, checklist_items: updated };
    setWo(optimisticWo);
    if (onUpdated) onUpdated(optimisticWo);

    try {
      const res = await updateWorkOrder(wo.id, { checklist_items: updated });
      setWo(res.data);
      if (onUpdated) onUpdated(res.data);
    } catch (err) {
      console.error('Error updating checklist step:', err);
      refreshWorkOrder();
    }
  };

  const handleCopyNumber = () => {
    if (!wo?.order_number) return;
    navigator.clipboard.writeText(wo.order_number);
    setCopiedWoNumber(true);
    setTimeout(() => setCopiedWoNumber(false), 2000);
  };

  const handleAdjustLaborHours = (delta) => {
    setLaborHours(prev => {
      const cur = parseFloat(prev) || 0;
      const next = Math.max(0.25, Math.round((cur + delta) * 100) / 100);
      return String(next);
    });
  };

  const handleLogLabor = async (e) => {
    e.preventDefault();
    setLaborError(null);

    if (isPendingTriage) {
      setLaborError('Work order must be triaged before labor hours can be added.');
      return;
    }

    const numHours = parseFloat(laborHours);
    if (!numHours || numHours <= 0) {
      setLaborError('Please enter a valid labor hour value (e.g. 1.5).');
      return;
    }

    setIsLoggingLabor(true);
    try {
      await addWorkOrderLabor(wo.id, {
        hours: numHours,
        comment: laborComment.trim() || undefined,
      });
      setLaborHours('1.0');
      setLaborComment('');
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error logging labor:', err);
      setLaborError(getErrorMessage(err, 'Failed to log labor hours.'));
    } finally {
      setIsLoggingLabor(false);
    }
  };

  const startEditLabor = (le) => {
    setEditingLaborId(le.id);
    setEditLaborHours(String(le.hours));
    setEditLaborComment(le.comment || '');
    setLaborError(null);
  };

  const cancelEditLabor = () => {
    setEditingLaborId(null);
    setEditLaborHours('');
    setEditLaborComment('');
  };

  const handleSaveEditLabor = async (laborId) => {
    const h = parseFloat(editLaborHours);
    if (isNaN(h) || h <= 0) {
      setLaborError('Please enter a valid labor hour value (greater than 0).');
      return;
    }
    setIsSavingLabor(true);
    setLaborError(null);
    try {
      await updateWorkOrderLabor(wo.id, laborId, {
        hours: h,
        comment: editLaborComment.trim() || undefined
      });
      setEditingLaborId(null);
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error updating labor entry:', err);
      setLaborError(getErrorMessage(err, 'Failed to update labor entry.'));
    } finally {
      setIsSavingLabor(false);
    }
  };

  const handleDeleteLaborEntry = async (laborId) => {
    if (!window.confirm('Are you sure you want to remove this logged labor entry?')) {
      return;
    }
    try {
      await deleteWorkOrderLabor(wo.id, laborId);
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error deleting labor entry:', err);
      setLaborError(getErrorMessage(err, 'Failed to delete labor entry.'));
    }
  };

  const handlePostComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setCommentError(null);
    setIsPostingComment(true);

    try {
      await addWorkOrderComment(wo.id, {
        comment: commentText.trim(),
        author_name: currentUser?.full_name || currentUser?.username || 'Technician',
      });
      setCommentText('');
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error posting comment:', err);
      setCommentError(getErrorMessage(err, 'Failed to add comment.'));
    } finally {
      setIsPostingComment(false);
    }
  };

  const startEditComment = (c) => {
    setEditingCommentId(c.id);
    setEditCommentText(c.comment || '');
    setCommentError(null);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditCommentText('');
  };

  const handleSaveEditComment = async (commentId) => {
    if (!editCommentText.trim()) {
      setCommentError('Note/comment text cannot be empty.');
      return;
    }
    setIsSavingComment(true);
    setCommentError(null);
    try {
      await updateWorkOrderComment(wo.id, commentId, {
        comment: editCommentText.trim()
      });
      setEditingCommentId(null);
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error updating comment:', err);
      setCommentError(getErrorMessage(err, 'Failed to update note.'));
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Are you sure you want to delete this note?')) {
      return;
    }
    try {
      await deleteWorkOrderComment(wo.id, commentId);
      await refreshWorkOrder();
    } catch (err) {
      console.error('Error deleting comment:', err);
      setCommentError(getErrorMessage(err, 'Failed to delete note.'));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to permanently delete work order ${wo.order_number}?`)) return;
    try {
      await deleteWorkOrder(wo.id);
      if (onUpdated) onUpdated(null, wo.id);
      onClose();
    } catch (err) {
      if (err.response?.status === 404) {
        // DELETE is already satisfied when a stale cached work order no longer
        // exists on the server. Remove it from the current UI as deleted.
        if (onUpdated) onUpdated(null, wo.id);
        onClose();
        return;
      }
      console.error('Error deleting work order:', err);
      alert(getErrorMessage(err, 'Failed to delete work order.'));
    }
  };

  const handleTriageSuccess = (updatedWo) => {
    setWo(updatedWo);
    if (onUpdated) onUpdated(updatedWo);
    setIsTriageModalOpen(false);
  };

  const handleCloseSuccess = (closedWo) => {
    setWo(closedWo);
    if (onUpdated) onUpdated(closedWo);
    setIsCloseModalOpen(false);
    onClose();
  };

  const getPriorityBadge = (p) => {
    switch (p?.toLowerCase()) {
      case 'urgent':
        return <span className="badge badge-danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Critical / Urgent</span>;
      case 'high':
        return <span className="badge badge-warning" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>High Priority</span>;
      case 'low':
        return <span className="badge badge-success" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Low Priority</span>;
      default:
        return <span className="badge badge-info" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Medium Priority</span>;
    }
  };

  const getStatusBadge = (s) => {
    switch (s) {
      case 'pending_triage':
        return <span className="badge badge-warning" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Pending Triage</span>;
      case 'unassigned':
        return <span className="badge badge-warning" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Unassigned</span>;
      case 'assigned':
        return <span className="badge badge-info" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Assigned</span>;
      case 'in_progress':
        return <span className="badge badge-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>In Progress</span>;
      case 'completed':
        return <span className="badge badge-success" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Completed</span>;
      case 'on_hold':
        return <span className="badge badge-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>On Hold</span>;
      case 'cancelled':
        return <span className="badge badge-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Cancelled</span>;
      case 'rejected':
        return <span className="badge badge-danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>Rejected</span>;
      default:
        return <span className="badge badge-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>{s}</span>;
    }
  };

  // Labor Progress Percentage
  const estHours = parseFloat(wo.estimated_hours) || 0;
  const actHours = parseFloat(wo.actual_hours) || 0;
  const laborPercent = estHours > 0 ? Math.min(100, Math.round((actHours / estHours) * 100)) : 0;
  const scopeDescription = stripRepeatedWorkOrderTitle(wo.title, wo.description);

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose} style={{ zIndex: 1150 }}>
      <div
        className="modal-card modal-2xl glass-panel"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Work order ${wo.order_number}: ${wo.title}`}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        {/* ========================================================
            MODAL HEADER
            ======================================================== */}
        <div className="modal-card-header flex-wrap">
          {/* Left: WO Identifier & Badges */}
          <div className="flex items-center gap-sm flex-wrap">
            <div className="flex items-center gap-xs">
              <span className="tag-pill-blue font-bold">
                {wo.order_number}
              </span>
              <button
                type="button"
                onClick={handleCopyNumber}
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                title="Copy Work Order Number"
              >
                {copiedWoNumber ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </div>

            <div className="flex items-center gap-xs flex-wrap">
              {getStatusBadge(wo.status)}
              {getPriorityBadge(wo.priority)}
              <span className="badge badge-secondary">
                {wo.category || 'General'}
              </span>
              {wo.task_type_name && (
                <span className="badge badge-secondary" title={`Task type: ${wo.task_type_name}`}>
                  Task type: {wo.task_type_name}
                </span>
              )}
              {wo.trade && (
                <span
                  className="badge badge-info gap-xs"
                  title={`Assigned Trade: ${wo.trade}`}
                >
                  <Wrench size={12} />
                  <span>{wo.trade}</span>
                </span>
              )}
            </div>
          </div>

          {/* Right: Single Edit Details Button, Print & Close */}
          <div className="flex items-center gap-xs">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              disabled={!canWrite}
              className="btn btn-secondary btn-sm gap-xs"
              title="Edit Work Order Details"
            >
              <Edit3 size={14} />
              <span>Edit Details</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              className="btn btn-secondary btn-sm gap-xs"
              title="Print Work Order Ticket"
            >
              <Printer size={14} />
              <span>Print</span>
            </button>

            {isPendingTriage && isTriageUser && (
              <button
                type="button"
                onClick={() => setIsTriageModalOpen(true)}
                className="btn btn-primary btn-sm gap-xs"
              >
                <ShieldAlert size={14} />
                <span>Triage Request</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon-xs text-muted hover:text-primary ml-xs"
              title="Close modal (Esc)"
              aria-label="Close work-order details"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ========================================================
            MODAL SCROLLABLE BODY
            ======================================================== */}
        <div
          className="modal-body-scrollable"
          style={{
            padding: '1.5rem',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}
        >
          {/* Work Order Title & Description Card */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--surface-border)',
              borderRadius: '12px',
              padding: '1.25rem 1.5rem'
            }}
          >
            <h1
              style={{
                fontSize: '1.3rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 0.65rem 0',
                lineHeight: 1.35
              }}
            >
              {wo.title}
            </h1>

            {scopeDescription ? (
              <p
                style={{
                  fontSize: '0.92rem',
                  color: 'var(--text-secondary)',
                  margin: 0,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap'
                }}
              >
                {scopeDescription}
              </p>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0 }}>
                No additional description provided.
              </p>
            )}
          </div>

          {/* ========================================================
              TASK TEMPLATE & INTERACTIVE CHECKLIST SECTION
              ======================================================== */}
          {(wo.task_sheet_id || wo.task_sheet || (wo.checklist_items && wo.checklist_items.length > 0)) && (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--surface-border)',
                borderRadius: '12px',
                padding: '1.25rem 1.5rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckSquare size={16} style={{ color: '#3b82f6' }} />
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Procedural Checklist & Task Steps
                  </h3>
                </div>

                {wo.checklist_items?.length > 0 && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {wo.checklist_items.filter(i => typeof i === 'object' && i.completed).length} of {wo.checklist_items.length} completed
                  </span>
                )}
              </div>

              {/* Linked Task Sheet Info Pill */}
              {(wo.task_description || wo.task_code || wo.task_sheet_id || wo.task_id) && (
                <div style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '8px',
                  padding: '0.55rem 0.85rem',
                  marginBottom: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ListChecks size={15} style={{ color: '#60a5fa' }} />
                    <span style={{ color: 'var(--text-primary)' }}>
                      Linked task sheet: <strong>{wo.task_description || wo.task_code || `Task sheet #${wo.task_sheet_id || wo.task_id}`}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Interactive Checklist Items */}
              {wo.checklist_items?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {wo.checklist_items.map((item, idx) => {
                    const stepText = typeof item === 'string' ? item : (item.task || item.text || `Step ${idx + 1}`);
                    const isChecked = typeof item === 'object' && Boolean(item.completed);
                    const isReading = typeof item === 'object' && item.type === 'reading';

                    return (
                      <div
                        key={item.id || idx}
                        onClick={() => canWrite && handleToggleChecklistStep(idx)}
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-disabled={!canWrite}
                        tabIndex={canWrite ? 0 : -1}
                        onKeyDown={event => { if (canWrite && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleToggleChecklistStep(idx); } }}
                        style={{
                          background: isChecked ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                          border: isChecked ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--surface-border)',
                          borderRadius: '8px',
                          padding: '0.55rem 0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.65rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '5px',
                            border: isChecked ? '1px solid #10b981' : '1px solid var(--border-color)',
                            background: isChecked ? '#10b981' : 'rgba(255, 255, 255, 0.05)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          {isChecked && <Check size={14} />}
                        </div>

                        <span style={{
                          fontSize: '0.85rem',
                          color: isChecked ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: isChecked ? 'line-through' : 'none',
                          flex: 1,
                          lineHeight: 1.4
                        }}>
                          {stepText}
                          {isReading && item.unit && (
                            <span className="badge badge-secondary" style={{ marginLeft: '6px', fontSize: '0.72rem', padding: '0.1rem 0.4rem' }}>
                              [{item.unit}]
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  No checklist items for this task.
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              PENDING TRIAGE ALERT BANNER (If not triaged yet)
              ======================================================== */}
          {isPendingTriage && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(217, 119, 6, 0.08))',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: '12px',
                padding: '1.15rem 1.4rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: '240px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#f59e0b',
                    flexShrink: 0
                  }}
                >
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fbbf24', margin: '0 0 0.2rem 0' }}>
                    Awaiting Triage & Dispatch
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                    This work order must be triaged before technicians can be dispatched or log labor hours.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              GRID INFORMATION PANELS (Requester, Location, Schedule & Techs)
              ======================================================== */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
              gap: '1rem'
            }}
          >
            {/* 1. Requester Information */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--surface-border)',
                borderRadius: '12px',
                padding: '1.15rem'
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <User size={13} style={{ color: '#3b82f6' }} />
                <span>Requester Details</span>
              </div>

              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                {wo.requester_name || 'Anonymous User'}
              </div>

              {wo.requester_email && (
                <a
                  href={`mailto:${wo.requester_email}`}
                  style={{
                    fontSize: '0.82rem',
                    color: '#60a5fa',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    marginBottom: '0.25rem'
                  }}
                >
                  <Mail size={12} />
                  <span>{wo.requester_email}</span>
                </a>
              )}

              {wo.requester_phone && (
                <a
                  href={`tel:${wo.requester_phone}`}
                  style={{
                    fontSize: '0.82rem',
                    color: '#60a5fa',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    marginBottom: '0.25rem'
                  }}
                >
                  <Phone size={12} />
                  <span>{wo.requester_phone}</span>
                </a>
              )}

              {/* Client Telemetry (IP & Device) - Default Hidden & Compact */}
              {(wo.ip_address || wo.device_details) && (
                <div
                  style={{
                    marginTop: '0.45rem',
                    paddingTop: '0.45rem',
                    borderTop: '1px dashed rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowTelemetry(!showTelemetry)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#94a3b8',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                    className="hover:text-primary"
                  >
                    <Globe size={11} style={{ color: '#38bdf8' }} />
                    <span>{showTelemetry ? 'Hide Client Telemetry' : 'Client & IP Telemetry'}</span>
                    <span style={{ fontSize: '0.62rem', opacity: 0.7 }}>{showTelemetry ? '▲' : '▼'}</span>
                  </button>

                  {showTelemetry && (
                    <div
                      style={{
                        marginTop: '0.25rem',
                        padding: '0.45rem 0.6rem',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.3rem'
                      }}
                    >
                      {wo.ip_address && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                            <Network size={11} style={{ color: '#38bdf8' }} />
                            <span>IP:</span>
                            <span style={{ fontFamily: 'monospace', color: '#f1f5f9', fontWeight: 600 }}>{wo.ip_address}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleCopyIp(wo.ip_address, e)}
                            className="btn btn-ghost btn-icon-xs"
                            title="Copy IP Address"
                            style={{ padding: '0.05rem 0.2rem', height: 'auto', minHeight: 'unset', color: copiedIp ? '#34d399' : '#94a3b8' }}
                          >
                            {copiedIp ? <Check size={10} /> : <Copy size={10} />}
                          </button>
                        </div>
                      )}

                      {wo.device_details && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          <Globe size={11} style={{ color: '#a78bfa', flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ color: '#cbd5e1', lineHeight: 1.3 }} title={wo.device_details}>
                            {wo.device_details}
                          </span>
                        </div>
                      )}

                      {wo.user_agent && (
                        <div style={{ marginTop: '0.15rem', paddingTop: '0.2rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <button
                            type="button"
                            onClick={() => setShowUserAgent(!showUserAgent)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: '#64748b',
                              fontSize: '0.67rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem'
                            }}
                          >
                            <Info size={10} />
                            <span>{showUserAgent ? 'Hide Raw UA' : 'Raw User Agent'}</span>
                          </button>
                          {showUserAgent && (
                            <pre
                              style={{
                                margin: '0.25rem 0 0 0',
                                padding: '0.35rem 0.45rem',
                                background: 'rgba(0, 0, 0, 0.4)',
                                borderRadius: '4px',
                                fontSize: '0.64rem',
                                color: '#94a3b8',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all'
                              }}
                            >
                              {wo.user_agent}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Location Information */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--surface-border)',
                borderRadius: '12px',
                padding: '1.15rem'
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Building size={13} style={{ color: '#3b82f6' }} />
                  <span>Facility Location</span>
                </div>

                {wo.floorplan_id && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectMapLocation) onSelectMapLocation(wo, 'workOrder');
                      onClose();
                    }}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.25rem 0.6rem',
                      fontSize: '0.72rem',
                      borderRadius: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                    title="Navigate to Floorplan Map"
                  >
                    <MapPin size={11} style={{ color: '#60a5fa' }} />
                    <span>View Map</span>
                  </button>
                )}
              </div>

              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                {wo.site_name || 'Campus / Unassigned Site'}
                {wo.floorplan_name && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> • {wo.floorplan_name}</span>}
              </div>

              {/* Linked Rooms & Equipment Buttons */}
              {(wo.rooms?.length > 0 || wo.equipment?.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                  {wo.rooms?.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        if (onSelectMapLocation) onSelectMapLocation(r, 'room');
                        onClose();
                      }}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.72rem',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        background: 'rgba(59, 130, 246, 0.15)',
                        borderColor: 'rgba(59, 130, 246, 0.3)',
                        color: '#93c5fd'
                      }}
                    >
                      <Building size={10} />
                      <span>Room {r.name}</span>
                    </button>
                  ))}

                  {wo.equipment?.map(eq => (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => {
                        if (onSelectMapLocation) onSelectMapLocation(eq, 'equipment');
                        onClose();
                      }}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.72rem',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        background: 'rgba(16, 185, 129, 0.15)',
                        borderColor: 'rgba(16, 185, 129, 0.3)',
                        color: '#6ee7b7'
                      }}
                    >
                      <Wrench size={10} />
                      <span>{eq.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {wo.location_details && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.45rem' }}>
                  {wo.location_details}
                </div>
              )}
            </div>

            {/* 3. Assigned Technicians & Schedule */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--surface-border)',
                borderRadius: '12px',
                padding: '1.15rem'
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <Clock size={13} style={{ color: '#3b82f6' }} />
                <span>Assignment & Schedule</span>
              </div>

              {/* Assignees */}
              <div style={{ marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  Assigned Technicians:
                </span>
                {wo.assignees?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {wo.assignees.map(u => (
                      <span
                        key={u.id}
                        className="badge badge-info"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <User size={11} />
                        <span>{u.full_name || u.username}</span>
                        {u.trade && (
                          <span style={{
                            fontSize: '0.68rem',
                            padding: '0.05rem 0.35rem',
                            borderRadius: '3px',
                            background: 'rgba(255, 255, 255, 0.2)',
                            color: '#fff',
                            fontWeight: 600
                          }}>
                            {u.trade}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.82rem', color: '#fbbf24', fontWeight: 600 }}>
                    {isPendingTriage ? 'Pending Triage (Awaiting Review)' : 'Unassigned (Awaiting Technician)'}
                  </span>
                )}
              </div>

              {/* Due Date & Created */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {wo.start_date && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
                    <Calendar size={12} style={{ color: '#10b981' }} />
                    <span><strong>Scheduled Start:</strong> {new Date(wo.start_date).toLocaleString()}</span>
                  </div>
                )}
                {wo.due_date && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
                    <Calendar size={12} style={{ color: '#60a5fa' }} />
                    <span><strong>Due Date:</strong> {new Date(wo.due_date).toLocaleString()}</span>
                  </div>
                )}
                <div>
                  <strong>Created:</strong> {new Date(wo.created_at).toLocaleString()}
                </div>
                {wo.completed_at && (
                  <div style={{ color: '#10b981' }}>
                    <strong>Completed:</strong> {new Date(wo.completed_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ========================================================
              LABOR HOURS & CONTINUOUS LOGGING SECTION
              ======================================================== */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--surface-border)',
              borderRadius: '12px',
              padding: '1.25rem 1.5rem'
            }}
          >
            {/* Header with Stats */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={16} style={{ color: '#3b82f6' }} />
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Labor Hours & Work Activity Log
                </h3>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Est: <strong style={{ color: 'var(--text-primary)' }}>{wo.estimated_hours || 0} hrs</strong>
                </div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: '#60a5fa',
                    background: 'rgba(59, 130, 246, 0.15)',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '6px'
                  }}
                >
                  Actual: {wo.actual_hours || 0} hrs
                </div>
              </div>
            </div>

            {/* Labor Progress Bar (if estimated > 0) */}
            {estHours > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div
                  style={{
                    height: '6px',
                    borderRadius: '999px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${laborPercent}%`,
                      background: laborPercent > 100
                        ? '#ef4444'
                        : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Labor Error Message */}
            {laborError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.82rem',
                  color: '#f87171',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem'
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{laborError}</span>
              </div>
            )}

            {/* Labor Logging Form (LOCKED IF PENDING TRIAGE) */}
            {isPendingTriage ? (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px dashed rgba(245, 158, 11, 0.3)',
                  borderRadius: '10px',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  marginBottom: '1.25rem',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <ShieldAlert size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.85rem', color: '#fbbf24' }}>
                    Labor logging is locked. You must triage and assign this work order before technicians can record hours.
                  </span>
                </div>

                {isTriageUser && (
                  <button
                    type="button"
                    onClick={() => setIsTriageModalOpen(true)}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.45rem 0.95rem',
                      fontSize: '0.8rem',
                      borderRadius: '6px'
                    }}
                  >
                    Triage Order
                  </button>
                )}
              </div>
            ) : !isCompleted && canWrite ? (
              <form
                onSubmit={handleLogLabor}
                style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '10px',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {/* Hours Stepper Input */}
                  <div style={{ width: '150px' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      Hours to Log *
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => handleAdjustLaborHours(-0.5)}
                        className="btn btn-secondary btn-icon"
                        style={{ padding: '0.5rem', borderRadius: '6px' }}
                        title="Decrease 0.5h"
                      >
                        <Minus size={13} />
                      </button>

                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="24"
                        className="input-field"
                        value={laborHours}
                        aria-label="Hours to log"
                        onChange={e => setLaborHours(e.target.value)}
                        required
                        style={{
                          width: '100%',
                          textAlign: 'center',
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          padding: '0.5rem 0.4rem',
                          borderRadius: '6px',
                          background: 'rgba(15, 23, 42, 0.7)',
                          border: '1px solid var(--surface-border)',
                          color: '#60a5fa'
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => handleAdjustLaborHours(0.5)}
                        className="btn btn-secondary btn-icon"
                        style={{ padding: '0.5rem', borderRadius: '6px' }}
                        title="Increase 0.5h"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Work Performed Description */}
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      Work Performed / Notes
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Diagnosed leak, replaced pressure seal..."
                      value={laborComment}
                      aria-label="Work performed or notes"
                      onChange={e => setLaborComment(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.55rem 0.85rem',
                        fontSize: '0.85rem',
                        borderRadius: '6px',
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid var(--surface-border)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoggingLabor}
                    className="btn btn-primary"
                    style={{
                      padding: '0.55rem 1.25rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      borderRadius: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem'
                    }}
                  >
                    {isLoggingLabor ? (
                      <>
                        <RefreshCw size={14} className="spinning" />
                        <span>Logging...</span>
                      </>
                    ) : (
                      <>
                        <Plus size={15} />
                        <span>Log Labor</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Quick Presets */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.65rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', alignSelf: 'center', marginRight: '0.25rem' }}>
                    Quick presets:
                  </span>
                  {LABOR_HOUR_PRESETS.map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setLaborHours(String(h))}
                      style={{
                        padding: '0.15rem 0.45rem',
                        fontSize: '0.72rem',
                        borderRadius: '6px',
                        border: parseFloat(laborHours) === h
                          ? '1px solid #3b82f6'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        background: parseFloat(laborHours) === h
                          ? 'rgba(59, 130, 246, 0.25)'
                          : 'rgba(255, 255, 255, 0.04)',
                        color: parseFloat(laborHours) === h ? '#93c5fd' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </form>
            ) : null}

            {/* Labor Entries Stream */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
              {wo.labor_entries?.length === 0 ? (
                <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No labor entries logged yet. Record hours performed above without closing the ticket.
                </div>
              ) : (
                wo.labor_entries.map(le => {
                  const isEditing = editingLaborId === le.id;
                  const canManage = canWrite && Boolean(
                    currentUser?.role === 'admin' ||
                    (le.user_id && currentUser?.id && le.user_id === currentUser.id) ||
                    (le.user_username && currentUser?.username && le.user_username === currentUser.username)
                  );

                  if (isEditing) {
                    return (
                      <div
                        key={le.id}
                        style={{
                          background: 'rgba(59, 130, 246, 0.08)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '8px',
                          padding: '0.75rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#93c5fd' }}>
                            Edit Logged Hours ({le.user_display_name || le.user_full_name || le.user_username || 'Technician'})
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            {new Date(le.entry_date || le.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ width: '110px' }}>
                            <input
                              type="number"
                              step="any"
                              min="0.01"
                              max="24"
                              className="input-field"
                              value={editLaborHours} aria-label="Edit logged hours"
                              onChange={e => setEditLaborHours(e.target.value)}
                              placeholder="Hours"
                              style={{
                                width: '100%',
                                padding: '0.4rem 0.5rem',
                                fontSize: '0.85rem',
                                textAlign: 'center',
                                fontWeight: 700,
                                color: '#60a5fa'
                              }}
                              required
                            />
                          </div>

                          <div style={{ flex: 1, minWidth: '180px' }}>
                            <input
                              type="text"
                              className="input-field"
                              value={editLaborComment} aria-label="Edit labor notes"
                              onChange={e => setEditLaborComment(e.target.value)}
                              placeholder="Work performed / description..."
                              style={{
                                width: '100%',
                                padding: '0.4rem 0.65rem',
                                fontSize: '0.85rem'
                              }}
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={cancelEditLabor}
                              disabled={isSavingLabor}
                              className="btn btn-secondary btn-xs"
                              style={{ padding: '0.4rem 0.65rem' }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEditLabor(le.id)}
                              disabled={isSavingLabor}
                              className="btn btn-primary btn-xs"
                              style={{ padding: '0.4rem 0.75rem', gap: '4px' }}
                            >
                              {isSavingLabor ? <RefreshCw size={12} className="spinning" /> : <Check size={12} />}
                              <span>Save</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={le.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {le.user_display_name || le.user_full_name || le.user_username || 'Technician'}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {new Date(le.entry_date || le.created_at).toLocaleDateString()} {new Date(le.entry_date || le.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {le.comment && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem', wordBreak: 'break-word' }}>
                            {le.comment}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            color: '#60a5fa',
                            background: 'rgba(59, 130, 246, 0.15)',
                            padding: '0.25rem 0.55rem',
                            borderRadius: '6px'
                          }}
                        >
                          +{le.hours} hrs
                        </span>

                        {canManage && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <button
                              type="button"
                              onClick={() => startEditLabor(le)}
                              className="btn btn-ghost"
                              style={{
                                padding: '0.3rem',
                                borderRadius: '6px',
                                color: 'var(--text-secondary)'
                              }}
                              title="Edit logged hours"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteLaborEntry(le.id)}
                              className="btn btn-ghost"
                              style={{
                                padding: '0.3rem',
                                borderRadius: '6px',
                                color: '#f87171'
                              }}
                              title="Delete logged hours"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ========================================================
              NOTES & DISCUSSION STREAM SECTION
              ======================================================== */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--surface-border)',
              borderRadius: '12px',
              padding: '1.25rem 1.5rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <MessageSquare size={16} style={{ color: '#3b82f6' }} />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Activity & Discussion Notes ({wo.comments?.length || 0})
              </h3>
            </div>

            {commentError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.82rem',
                  color: '#f87171',
                  marginBottom: '0.85rem'
                }}
              >
                {commentError}
              </div>
            )}

            {/* Comment List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', marginBottom: '1rem' }}>
              {wo.comments?.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No comments or internal notes recorded yet.
                </div>
              ) : (
                wo.comments.map(c => {
                  const isEditing = editingCommentId === c.id;
                  const canManageComment = canWrite && Boolean(
                    currentUser?.role === 'admin' ||
                    (c.user_id && currentUser?.id && c.user_id === currentUser.id) ||
                    (c.author_name && currentUser?.username && c.author_name === currentUser.username)
                  );

                  if (isEditing) {
                    return (
                      <div
                        key={c.id}
                        style={{
                          background: 'rgba(59, 130, 246, 0.08)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '8px',
                          padding: '0.75rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#93c5fd' }}>
                            Edit Note ({c.author_name})
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <textarea
                          className="input-field"
                          rows={2}
                          value={editCommentText} aria-label="Edit internal note"
                          onChange={e => setEditCommentText(e.target.value)}
                          placeholder="Edit note..."
                          style={{
                            width: '100%',
                            padding: '0.45rem 0.65rem',
                            fontSize: '0.85rem',
                            borderRadius: '6px'
                          }}
                          required
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={cancelEditComment}
                            disabled={isSavingComment}
                            className="btn btn-secondary btn-xs"
                            style={{ padding: '0.35rem 0.65rem' }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEditComment(c.id)}
                            disabled={isSavingComment}
                            className="btn btn-primary btn-xs"
                            style={{ padding: '0.35rem 0.75rem', gap: '4px' }}
                          >
                            {isSavingComment ? <RefreshCw size={12} className="spinning" /> : <Check size={12} />}
                            <span>Save</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={c.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            {c.author_name}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {new Date(c.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {c.comment}
                        </div>
                      </div>

                      {canManageComment && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => startEditComment(c)}
                            className="btn btn-ghost"
                            style={{
                              padding: '0.3rem',
                              borderRadius: '6px',
                              color: 'var(--text-secondary)'
                            }}
                            title="Edit note"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.id)}
                            className="btn btn-ghost"
                            style={{
                              padding: '0.3rem',
                              borderRadius: '6px',
                              color: '#f87171'
                            }}
                            title="Delete note"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* New Comment Input Form */}
            <form onSubmit={handlePostComment} style={{ display: 'flex', gap: '0.65rem' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Add an internal note or update..."
                value={commentText}
                aria-label="Internal note"
                disabled={!canWrite}
                onChange={e => setCommentText(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid var(--surface-border)',
                  color: 'var(--text-primary)'
                }}
              />
              <button
                type="submit"
                disabled={!canWrite || isPostingComment || !commentText.trim()}
                className="btn btn-secondary"
                style={{
                  padding: '0.65rem 1.15rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem'
                }}
              >
                {isPostingComment ? (
                  <RefreshCw size={14} className="spinning" />
                ) : (
                  <Send size={14} />
                )}
                <span>Post Note</span>
              </button>
            </form>
          </div>
        </div>

        {/* ========================================================
            MODAL FOOTER ACTIONS
            ======================================================== */}
        <div
          className="modal-footer-bar"
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--surface-border)',
            background: 'rgba(15, 23, 42, 0.95)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }}
        >
          {/* Left: Delete action */}
          <div>
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="btn btn-ghost text-danger"
                style={{
                  padding: '0.55rem 0.95rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem'
                }}
              >
                <Trash2 size={15} />
                <span>Delete Ticket</span>
              </button>
            )}
          </div>

          {/* Right: Primary actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {isPendingTriage && isTriageUser && (
              <button
                type="button"
                onClick={() => setIsTriageModalOpen(true)}
                className="btn btn-primary"
                style={{
                  padding: '0.6rem 1.35rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  border: 'none',
                  color: '#fff'
                }}
              >
                <ShieldAlert size={16} />
                <span>Triage Order</span>
              </button>
            )}

            {canWrite && !isPendingTriage && !isCompleted && (
              <button
                type="button"
                onClick={() => setIsCloseModalOpen(true)}
                className="btn btn-primary btn-success-gradient"
                style={{
                  padding: '0.6rem 1.35rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <CheckCircle2 size={16} />
                <span>Complete Work Order</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{
                padding: '0.6rem 1.25rem',
                fontSize: '0.85rem',
                borderRadius: '8px'
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Dedicated Edit Modal */}
        {isEditModalOpen && (
          <WorkOrderEditModal
            workOrder={wo}
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            onUpdated={(updatedWo) => {
              setWo(updatedWo);
              if (onUpdated) onUpdated(updatedWo);
            }}
            currentUser={currentUser}
          />
        )}

        {/* Dedicated Triage Modal */}
        {isTriageModalOpen && (
          <WorkOrderTriageModal
            workOrder={wo}
            isOpen={isTriageModalOpen}
            onClose={() => setIsTriageModalOpen(false)}
            onSuccess={handleTriageSuccess}
            currentUser={currentUser}
          />
        )}

        {/* Dedicated Closeout Modal */}
        {isCloseModalOpen && (
          <CloseWorkOrderModal
            workOrder={wo}
            onClose={() => setIsCloseModalOpen(false)}
            onSuccess={handleCloseSuccess}
          />
        )}

        {/* Print Modal */}
        {isPrintModalOpen && (
          <WorkOrderPrintModal
            isOpen={isPrintModalOpen}
            onClose={() => setIsPrintModalOpen(false)}
            workOrders={[wo]}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
