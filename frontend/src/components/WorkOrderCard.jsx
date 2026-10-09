import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Building, CalendarClock, Check, ChevronDown, ChevronUp, Copy, MapPin, Printer, User, Wrench
} from 'lucide-react';
import { isWorkOrderOverdue, parseWorkOrderDueDate } from '../utils/workOrderDueDate';
import './WorkOrderCard.css';

const STATUS_LABELS = {
  pending_triage: 'Needs triage',
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
  rejected: 'Rejected'
};

const PRIORITY_LABELS = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

export default function WorkOrderCard({
  workOrder,
  onSelect,
  onClose,
  onPrint,
  goToMap,
  isSelected = false,
  onToggleSelect,
  className = ''
}) {
  const [copied, setCopied] = useState(false);
  const [isEquipmentExpanded, setIsEquipmentExpanded] = useState(false);
  const [hasEquipmentOverflow, setHasEquipmentOverflow] = useState(false);
  const equipmentListId = useId();
  const equipmentRowRef = useRef(null);
  const equipmentLinksRef = useRef(null);

  useLayoutEffect(() => {
    const row = equipmentRowRef.current;
    const links = equipmentLinksRef.current;
    if (!row || !links) return undefined;

    const measureOverflow = () => {
      const equipmentButtons = Array.from(links.children);
      const gap = Number.parseFloat(window.getComputedStyle(links).columnGap) || 0;
      const requiredWidth = equipmentButtons.reduce(
        (width, button) => width + button.getBoundingClientRect().width,
        gap * Math.max(0, equipmentButtons.length - 1)
      );
      setHasEquipmentOverflow(requiredWidth > row.clientWidth + 1);
    };

    measureOverflow();
    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(row);
    return () => resizeObserver.disconnect();
  }, [workOrder?.equipment]);

  if (!workOrder) return null;
  const wo = workOrder;

  const handleCopyNumber = async (event) => {
    event?.stopPropagation?.();
    await navigator.clipboard.writeText(wo.order_number);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const parsedDate = parseWorkOrderDueDate(dateStr);
      if (!parsedDate) return dateStr;
      return parsedDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const handleRoomClick = (event, room) => {
    event.stopPropagation();
    goToMap?.({ ...room, floorplan_id: room.floorplan_id || wo.floorplan_id }, 'room');
  };

  const handleEquipmentClick = (event, equipment) => {
    event.stopPropagation();
    goToMap?.({ ...equipment, floorplan_id: equipment.floorplan_id || wo.floorplan_id }, 'equipment');
  };

  const handleLocationClick = (event) => {
    event.stopPropagation();
    if (!goToMap) return;
    const target = wo.rooms?.[0] || wo.equipment?.[0] || wo;
    const targetType = wo.rooms?.[0] ? 'room' : (wo.equipment?.[0] ? 'equipment' : 'workOrder');
    goToMap({ ...target, floorplan_id: target.floorplan_id || wo.floorplan_id }, targetType);
  };

  const hasLocation = Boolean(
    wo.site_name || wo.rooms?.length || wo.equipment?.length || wo.location_details || wo.floorplan_name
  );
  const isPastDue = isWorkOrderOverdue(wo);
  const statusLabel = STATUS_LABELS[wo.status] || wo.status || 'Unknown';
  const priority = wo.priority?.toLowerCase();
  const assigneeNames = wo.assignees?.length
    ? wo.assignees.map(user => user.full_name || user.username).join(', ')
    : 'Unassigned';

  return (
    <article
      className={`wo-mobile-card ${isSelected ? 'row-selected' : ''} ${wo.status === 'pending_triage' ? 'border-warning' : ''} ${className}`}
      onClick={() => onSelect?.(wo)}
    >
      <div className="wo-card-header">
        <div className="wo-card-identity">
          {onToggleSelect && (
            <input
              className="wo-card-checkbox"
              type="checkbox"
              checked={isSelected}
              onChange={(event) => {
                event.stopPropagation();
                onToggleSelect(wo.id, event);
              }}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select work order ${wo.order_number}`}
            />
          )}
          <span className="wo-card-number">{wo.order_number}</span>
          <button
            type="button"
            onClick={handleCopyNumber}
            className={`wo-card-icon-btn ${copied ? 'is-success' : ''}`}
            title={copied ? 'Order number copied' : 'Copy order number'}
            aria-label={copied ? 'Order number copied' : `Copy order number ${wo.order_number}`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>

        <div className="wo-card-state">
          {priority && (
            <span className={`wo-card-priority priority-${priority}`}>
              {PRIORITY_LABELS[priority] || wo.priority}
            </span>
          )}
          <span className={`wo-card-status status-${wo.status || 'unknown'}`}>{statusLabel}</span>
        </div>
      </div>

      <div className="wo-card-content">
        <h3 className="wo-card-title">{wo.title || 'Untitled work order'}</h3>
        <div className="wo-card-supporting">
          {wo.trade && <span><Wrench size={13} />{wo.trade}</span>}
          <span>Created {formatDate(wo.created_at)}</span>
        </div>
      </div>

      <section className="wo-card-task-fields" aria-label="Task details">
        <div><span>Category</span><strong>{wo.category || 'General'}</strong></div>
        <div><span>Task type</span><strong>{wo.task_type_name || wo.task_type_code || '—'}</strong></div>
      </section>

      {hasLocation && (
        <section className="wo-card-location" aria-label="Location">
          <button
            type="button"
            className="wo-card-location-main"
            onClick={handleLocationClick}
            disabled={!goToMap}
            title={goToMap ? 'View location on map' : undefined}
          >
            <MapPin size={16} />
            <span>
              <strong>{wo.site_name || 'Site'}</strong>
              {(wo.floorplan_name || wo.location_details) && (
                <small>{wo.floorplan_name || wo.location_details}</small>
              )}
            </span>
          </button>

          {(wo.rooms?.length > 0 || wo.equipment?.length > 0) && (
            <div className="wo-card-location-links">
              {wo.rooms?.map(room => (
                <button
                  key={`room-${room.id}`}
                  type="button"
                  onClick={(event) => handleRoomClick(event, room)}
                  disabled={!goToMap}
                  title={`View room ${room.name} on map`}
                >
                  <Building size={13} />
                  <span>Room {room.name}</span>
                </button>
              ))}
              {wo.equipment?.length > 0 && (
                <div className="wo-card-equipment-row" ref={equipmentRowRef}>
                  <div
                    className={`wo-card-equipment-links ${isEquipmentExpanded ? 'is-expanded' : ''}`}
                    id={equipmentListId}
                    ref={equipmentLinksRef}
                  >
                    {wo.equipment.map(equipment => (
                      <button
                        key={`equipment-${equipment.id}`}
                        type="button"
                        onClick={(event) => handleEquipmentClick(event, equipment)}
                        disabled={!goToMap}
                        title={`View ${equipment.name} on map`}
                      >
                        <Wrench size={13} />
                        <span>{equipment.name}</span>
                      </button>
                    ))}
                  </div>
                  {wo.equipment.length > 1 && (
                    <button
                      type="button"
                      className={`wo-card-equipment-toggle ${hasEquipmentOverflow ? '' : 'is-measuring'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsEquipmentExpanded(current => !current);
                      }}
                      aria-expanded={isEquipmentExpanded}
                      aria-controls={equipmentListId}
                      aria-hidden={!hasEquipmentOverflow}
                      tabIndex={hasEquipmentOverflow ? 0 : -1}
                    >
                      <span>{isEquipmentExpanded ? 'See less' : 'See more'}</span>
                      {isEquipmentExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <div className="wo-card-footer">
        <div className="wo-card-meta">
          <span className={wo.assignees?.length ? '' : 'is-warning'}>
            <User size={14} />
            <span>{assigneeNames}</span>
          </span>
          <span className={isPastDue ? 'is-danger' : ''}>
            <CalendarClock size={14} />
            <span>{wo.due_date ? `${isPastDue ? 'Overdue' : 'Due'} ${formatDate(wo.due_date)}` : 'No due date'}</span>
          </span>
        </div>

        <div className="wo-card-actions">
          {onSelect && (
            <button
              type="button"
              className="btn btn-primary wo-card-action-btn"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(wo);
              }}
            >
              <span>Open</span>
            </button>
          )}
          {onPrint && (
            <button
              type="button"
              className="btn btn-ghost wo-card-action-btn"
              onClick={(event) => {
                event.stopPropagation();
                onPrint(wo, event);
              }}
              aria-label={`Print work order ${wo.order_number}`}
            >
              <Printer size={15} />
              <span>Print</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="btn btn-secondary wo-card-action-btn"
              onClick={(event) => {
                event.stopPropagation();
                onClose(wo);
              }}
            >
              <Check size={15} />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
