import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Building2, CalendarCheck2, CalendarClock, CheckSquare2,
  Clock3, FileText, ListChecks, MapPin, RefreshCw, UserRound, Wrench, X,
} from 'lucide-react';
import { getErrorMessage, getPMSchedule } from '../api';
import './PMScheduleDetailModal.css';

const WEEKDAY_NAMES = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function describeRecurrence(schedule) {
  const rule = schedule?.recurrence_rule;
  if (!rule) return `Custom recurrence: ${schedule?.cron_expression || 'Not configured'}`;
  const interval = Number(rule.interval) || 1;
  let cadence;
  if (rule.frequency === 'daily') {
    cadence = interval === 1 ? 'Every day' : `Every ${interval} days`;
  } else if (rule.frequency === 'weekly') {
    const weekdays = (rule.weekly_days || []).map(day => WEEKDAY_NAMES[day] || day).join(', ');
    cadence = `${interval === 1 ? 'Every week' : `Every ${interval} weeks`}${weekdays ? ` on ${weekdays}` : ''}`;
  } else {
    const frequency = interval === 1 ? 'Every month'
      : interval === 3 ? 'Quarterly'
      : interval === 6 ? 'Semi-annually'
      : interval === 12 ? 'Annually'
      : `Every ${interval} months`;
    if (rule.monthly_type === 'last-day') cadence = `${frequency} on the last day`;
    else if (rule.monthly_type === 'relative-weekday') cadence = `${frequency} on the ${rule.ordinal} ${WEEKDAY_NAMES[rule.ordinal_day] || rule.ordinal_day}`;
    else cadence = `${frequency} on day ${rule.month_day}`;
  }
  return `${cadence} at ${rule.time_of_day || '00:00'} ${rule.timezone || schedule.timezone || 'UTC'}`;
}

function getChecklistLabel(item, index) {
  if (typeof item === 'string') return item;
  return item?.task || item?.label || item?.description || `Checklist step ${index + 1}`;
}

export default function PMScheduleDetailModal({ isOpen, scheduleId, occurrence, onClose }) {
  const [request, setRequest] = useState({ scheduleId: null, schedule: null, error: '' });
  const [retryCount, setRetryCount] = useState(0);
  const closeButtonRef = useRef(null);
  const isLoading = Boolean(isOpen && scheduleId && request.scheduleId !== `${scheduleId}-${retryCount}`);
  const schedule = isLoading ? null : request.schedule;
  const error = isLoading ? '' : request.error;

  useEffect(() => {
    if (!isOpen || !scheduleId) return undefined;
    let cancelled = false;
    const requestId = `${scheduleId}-${retryCount}`;
    getPMSchedule(scheduleId)
      .then(response => {
        if (!cancelled) setRequest({ scheduleId: requestId, schedule: response.data, error: '' });
      })
      .catch(fetchError => {
        if (!cancelled) {
          setRequest({
            scheduleId: requestId,
            schedule: null,
            error: getErrorMessage(fetchError, 'PM schedule details could not be loaded.'),
          });
        }
      });
    return () => { cancelled = true; };
  }, [isOpen, retryCount, scheduleId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !scheduleId) return null;

  const rooms = schedule?.rooms || [];
  const equipment = schedule?.equipment || [];
  const assignees = schedule?.assignees || [];
  const checklist = schedule?.checklist_items || [];

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark pm-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="modal-card modal-lg glass-panel pm-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-detail-title"
        aria-describedby="pm-detail-subtitle"
      >
        <header className="modal-card-header pm-detail-header">
          <div className="pm-detail-heading">
            <span className="pm-detail-heading-icon" aria-hidden="true"><CalendarCheck2 size={20} /></span>
            <div>
              <span className="pm-detail-eyebrow">Preventive maintenance</span>
              <h2 id="pm-detail-title">{schedule?.title || occurrence?.title || 'PM schedule details'}</h2>
              <p id="pm-detail-subtitle">Schedule and selected calendar occurrence details.</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="btn btn-ghost btn-icon-sm" onClick={onClose} aria-label="Close PM details" title="Close PM details" autoFocus>
            <X size={18} />
          </button>
        </header>

        <div className="modal-card-body pm-detail-body">
          {isLoading ? (
            <div className="pm-detail-state" role="status">
              <RefreshCw className="spinning" size={26} />
              <strong>Loading PM details</strong>
              <span>Retrieving the maintenance plan and linked assets.</span>
            </div>
          ) : error ? (
            <div className="pm-detail-state is-error" role="alert">
              <AlertTriangle size={28} />
              <strong>Unable to load PM details</strong>
              <span>{error}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetryCount(count => count + 1)}><RefreshCw size={14} /> Retry</button>
            </div>
          ) : schedule ? (
            <>
              <div className="pm-detail-summary">
                <div className="pm-detail-tags">
                  {schedule.task_code && <span className="pm-detail-task-code">{schedule.task_code}</span>}
                  <span className="badge badge-secondary">{schedule.category || 'Preventive Maintenance'}</span>
                  <span className={`badge badge-${schedule.priority === 'urgent' ? 'danger' : schedule.priority === 'high' ? 'warning' : 'secondary'}`}>{schedule.priority || 'medium'} priority</span>
                  <span className={`pm-detail-status ${schedule.is_active ? 'is-active' : ''}`}>{schedule.is_active ? 'Active' : 'Paused'}</span>
                </div>
                {schedule.description && <p>{schedule.description}</p>}
              </div>

              {occurrence && (
                <section className="pm-detail-occurrence" aria-labelledby="pm-detail-occurrence-heading">
                  <div className="pm-detail-section-heading">
                    <CalendarClock size={18} />
                    <div><span>Calendar occurrence</span><small id="pm-detail-occurrence-heading">The projected PM event selected from the work-order calendar.</small></div>
                  </div>
                  <div className="pm-detail-metadata-grid">
                    <div><span>Issue date</span><strong>{formatDateTime(occurrence.issue_datetime)}</strong></div>
                    <div><span>Due date</span><strong>{formatDateTime(occurrence.due_datetime)}</strong></div>
                  </div>
                  {occurrence.adjustment_reason && <p className="pm-detail-adjustment"><AlertTriangle size={14} /> {occurrence.adjustment_reason}</p>}
                </section>
              )}

              <section className="pm-detail-section" aria-labelledby="pm-detail-schedule-heading">
                <div className="pm-detail-section-heading">
                  <Clock3 size={18} />
                  <div><span id="pm-detail-schedule-heading">Schedule</span><small>Cadence, timing, and expected effort.</small></div>
                </div>
                <p className="pm-detail-recurrence">{describeRecurrence(schedule)}</p>
                <div className="pm-detail-metadata-grid">
                  <div><span>Next issue</span><strong>{formatDateTime(schedule.next_run_at)}</strong></div>
                  <div><span>Estimated labor</span><strong>{Number(schedule.estimated_hours || 0).toLocaleString()} hours</strong></div>
                  <div><span>Due after issue</span><strong>{schedule.recurrence_rule?.due_after_issued_days ?? 0} days</strong></div>
                  <div><span>Trade</span><strong>{schedule.trade || 'Not assigned'}</strong></div>
                </div>
              </section>

              <section className="pm-detail-section" aria-labelledby="pm-detail-assets-heading">
                <div className="pm-detail-section-heading">
                  <MapPin size={18} />
                  <div><span id="pm-detail-assets-heading">Assets and ownership</span><small>Linked location, equipment, rooms, and technicians.</small></div>
                </div>
                <div className="pm-detail-metadata-grid">
                  <div><span>Site</span><strong><Building2 size={13} /> {schedule.site_name || 'All sites'}</strong></div>
                  <div><span>Floorplan</span><strong><MapPin size={13} /> {schedule.floorplan_name || 'All floorplans'}</strong></div>
                </div>
                <div className="pm-detail-linked-groups">
                  <div>
                    <span className="pm-detail-field-label"><Wrench size={14} /> Equipment</span>
                    {equipment.length ? <div className="pm-detail-chips">{equipment.map(item => <span key={item.id}>{item.name || item.description || `Equipment ${item.id}`}</span>)}</div> : <p>None linked</p>}
                  </div>
                  <div>
                    <span className="pm-detail-field-label"><Building2 size={14} /> Rooms</span>
                    {rooms.length ? <div className="pm-detail-chips">{rooms.map(room => <span key={room.id}>{room.name || `Room ${room.id}`}</span>)}</div> : <p>None linked</p>}
                  </div>
                  <div>
                    <span className="pm-detail-field-label"><UserRound size={14} /> Assigned technicians</span>
                    {assignees.length ? <div className="pm-detail-chips">{assignees.map(user => <span key={user.id}>{user.full_name || user.username}</span>)}</div> : <p>Unassigned</p>}
                  </div>
                </div>
              </section>

              <section className="pm-detail-section" aria-labelledby="pm-detail-work-heading">
                <div className="pm-detail-section-heading">
                  <ListChecks size={18} />
                  <div><span id="pm-detail-work-heading">Standard work</span><small>Linked task reference and checklist requirements.</small></div>
                </div>
                {schedule.task_description && schedule.task_description !== schedule.title && (
                  <p className="pm-detail-task-reference"><FileText size={14} /> {schedule.task_description}</p>
                )}
                {checklist.length ? (
                  <ol className="pm-detail-checklist">
                    {checklist.map((item, index) => (
                      <li key={item?.id || `${getChecklistLabel(item, index)}-${index}`}>
                        <CheckSquare2 size={15} />
                        <span>{getChecklistLabel(item, index)}</span>
                        {typeof item === 'object' && item?.type && <small>{item.type === 'pass-fail' ? 'Pass / fail' : item.type === 'reading' ? `Reading${item.unit ? ` · ${item.unit}` : ''}` : 'Checkbox'}</small>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="pm-detail-muted">No checklist steps are attached to this maintenance plan.</p>}
              </section>
            </>
          ) : null}
        </div>

        <footer className="modal-card-footer pm-detail-footer">
          <span>Read-only calendar detail</span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
