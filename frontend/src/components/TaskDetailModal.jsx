import { createPortal } from 'react-dom';
import {
  X, BookOpen, Clock, Wrench, ListChecks,
  CheckCircle2, Calendar, FileText, Edit2, Play, CheckSquare,
  Layers, MapPin
} from 'lucide-react';
import './TaskModals.css';

export default function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onEdit,
  onSelect,
  onOpenPMSchedules
}) {
  if (!isOpen || !task) return null;

  const checklistCount = Array.isArray(task.checklist_items) ? task.checklist_items.length : 0;
  const hasSheet = Boolean(task.pm_task_sheet && task.pm_task_sheet.trim());
  const equipmentCount = Array.isArray(task.equipment) ? task.equipment.length : 0;
  const roomCount = Array.isArray(task.rooms) ? task.rooms.length : 0;
  const hasAssets = equipmentCount > 0 || roomCount > 0;

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark task-modal-layer-detail" onClick={onClose}>
      <div
        className="modal-card modal-lg glass-panel task-detail-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        {/* Header */}
        <div className="modal-card-header task-detail-header">
          <div className="task-modal-heading flex-1">
            <div className="icon-box-primary task-modal-icon">
              <BookOpen size={18} />
            </div>
            <div className="task-modal-heading-copy flex-1">
              <div className="task-modal-badges">
                {task.code && <span className="task-select-code">{task.code}</span>}
                <span className="badge badge-info">
                  {task.category || 'General'}
                </span>
                {task.trade && (
                  <span className="badge badge-info gap-xs">
                    <Wrench size={11} />
                    <span>{task.trade}</span>
                  </span>
                )}
                <span className={`badge ${task.is_active !== false ? 'badge-success' : 'badge-secondary'}`}>
                  <div className={`badge-dot ${task.is_active !== false ? 'active' : 'inactive'}`} />
                  <span>{task.is_active !== false ? 'Active task type' : 'Inactive task type'}</span>
                </span>
              </div>

              <h2 id="task-detail-title">
                {task.description}
              </h2>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-icon-sm task-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close task details"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="modal-card-body task-detail-content">
          {/* Key Metrics Row */}
          <div className="task-detail-metrics">
            <div className="task-detail-metric">
              <div className="task-detail-metric-label">
                <Clock size={13} />
                <span>Estimated labor</span>
              </div>
              <div className="task-detail-metric-value">
                {task.estimated_hours || 1.0} hr{Number(task.estimated_hours) !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="task-detail-metric">
              <div className="task-detail-metric-label">
                <ListChecks size={13} />
                <span>Checklist steps</span>
              </div>
              <div className="task-detail-metric-value">
                {checklistCount} step{checklistCount !== 1 ? 's' : ''}
              </div>
            </div>

            <button
              type="button"
              className="task-detail-metric"
              onClick={() => {
                if (onOpenPMSchedules) {
                  onClose();
                  onOpenPMSchedules(task);
                }
              }}
              title={onOpenPMSchedules ? `Open PM Schedule Builder for "${task.description}"` : ''}
              disabled={!onOpenPMSchedules}
            >
              <div className="task-detail-metric-label">
                <Calendar size={13} />
                <span>PM schedules</span>
              </div>
              <div className="task-detail-metric-value">
                {task.pm_schedules_count || 0} linked
              </div>
            </button>

            <div className="task-detail-metric">
              <div className="task-detail-metric-label">
                <CheckCircle2 size={13} />
                <span>Work orders</span>
              </div>
              <div className="task-detail-metric-value">
                {task.work_orders_count || 0} created
              </div>
            </div>
          </div>

          {/* Linked Assets (Equipment & Rooms) */}
          {hasAssets && (
            <section className="task-detail-section" aria-labelledby="task-detail-assets-heading">
              <div className="task-detail-section-title" id="task-detail-assets-heading">
                <Layers size={16} />
                <span>
                  Linked Assets ({[
                    equipmentCount ? `${equipmentCount} equipment` : '',
                    roomCount ? `${roomCount} room${roomCount !== 1 ? 's' : ''}` : '',
                  ].filter(Boolean).join(', ')})
                </span>
              </div>
              <div className="task-detail-assets-list">
                {task.equipment?.map(eq => (
                  <div key={`eq-${eq.id}`} className="task-detail-asset-item">
                    <span className="badge badge-info">Equipment</span>
                    <span className="task-detail-asset-name">{eq.name}</span>
                    {eq.floorplan_name && (
                      <span className="task-detail-asset-location text-muted">
                        <MapPin size={12} />
                        <span>{eq.floorplan_name}</span>
                      </span>
                    )}
                  </div>
                ))}
                {task.rooms?.map(rm => (
                  <div key={`rm-${rm.id}`} className="task-detail-asset-item">
                    <span className="badge badge-secondary">Room</span>
                    <span className="task-detail-asset-name">{rm.name}</span>
                    {rm.floorplan_name && (
                      <span className="task-detail-asset-location text-muted">
                        <MapPin size={12} />
                        <span>{rm.floorplan_name}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Optional task sheet */}
          {hasSheet && (
            <section className="task-detail-section" aria-labelledby="task-detail-procedure-heading">
              <div className="task-detail-section-title" id="task-detail-procedure-heading">
                <FileText size={16} />
                <span>Task sheet</span>
              </div>
              <div className="task-detail-procedure">
                {task.pm_task_sheet}
              </div>
            </section>
          )}

          {/* Checklist Items */}
          {checklistCount > 0 && (
            <section className="task-detail-section" aria-labelledby="task-detail-checklist-heading">
              <div className="task-detail-section-title" id="task-detail-checklist-heading">
                <CheckSquare size={16} />
                <span>Required verification checklist ({checklistCount} steps)</span>
              </div>
              <div className="task-detail-checklist">
                {task.checklist_items.map((item, index) => (
                  <div
                    key={item.id || index}
                    className="task-detail-checklist-item"
                  >
                    <div className="task-detail-step-index">
                      {index + 1}
                    </div>
                    <div className="task-detail-step-copy">
                      {item.task || item.description || (typeof item === 'string' ? item : JSON.stringify(item))}
                    </div>
                    {item.type && (
                      <span className="badge badge-secondary task-detail-step-type">
                        {item.type === 'reading' ? `Gauge reading (${item.unit || 'unit'})` : item.type}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer Actions */}
        <div className="modal-card-footer justify-between">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
          >
            Close
          </button>

          <div className="flex items-center gap-xs">
            {onEdit && (
              <button
                type="button"
                className="btn btn-secondary btn-sm gap-xs"
                onClick={() => {
                  onClose();
                  onEdit(task);
                }}
              >
                <Edit2 size={14} />
                <span>Edit template</span>
              </button>
            )}

            {onSelect && (
              <button
                type="button"
                className="btn btn-primary btn-sm gap-xs"
                onClick={() => {
                  onClose();
                  onSelect(task);
                }}
              >
                <Play size={14} />
                <span>Create work order</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
