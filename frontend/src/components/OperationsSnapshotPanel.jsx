import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DoorOpen,
  Layers3,
  LogIn,
  MapPin,
  Package,
  RefreshCw,
  Siren,
  Ticket,
  UserRoundSearch,
  Wrench,
  X
} from 'lucide-react';
import { getDashboardStatistics, getErrorMessage } from '../api';
import './OperationsSnapshotPanel.css';

const ACTIVE_STATUS_KEYS = new Set([
  'pending_triage',
  'unassigned',
  'assigned',
  'in_progress',
  'on_hold',
  'other'
]);

const STATUS_TONES = {
  pending_triage: 'warning',
  unassigned: 'warning',
  assigned: 'primary',
  in_progress: 'info',
  on_hold: 'danger',
  completed: 'success',
  cancelled: 'muted',
  rejected: 'muted'
};

const PRIORITY_TONES = {
  urgent: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'success'
};

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function getPercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function formatSnapshotTime(value) {
  if (!value) return 'Not refreshed yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatDayLabel(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    timeZone: 'UTC'
  }).format(date);
}

function MetricCard({ icon: Icon, label, value, note, tone = 'primary' }) {
  return (
    <article className={`ops-snapshot-metric is-${tone}`}>
      <div className="ops-snapshot-metric-heading">
        <span className="ops-snapshot-metric-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span>{label}</span>
      </div>
      <strong className="ops-snapshot-metric-value">{formatCount(value)}</strong>
      <span className="ops-snapshot-metric-note">{note}</span>
    </article>
  );
}

function ProgressRow({ label, value, max, tone = 'primary', detail }) {
  return (
    <div className="ops-snapshot-progress-row">
      <div className="ops-snapshot-progress-meta">
        <span className="ops-snapshot-progress-label">
          <span className={`ops-snapshot-status-mark is-${tone}`} aria-hidden="true" />
          {label}
        </span>
        <strong>{detail || formatCount(value)}</strong>
      </div>
      <progress
        className={`ops-snapshot-progress is-${tone}`}
        value={value}
        max={Math.max(max, 1)}
        aria-label={`${label}: ${detail || formatCount(value)}`}
      />
    </div>
  );
}

function DailyActivityChart({ days }) {
  const maximum = Math.max(
    1,
    ...days.flatMap(day => [Number(day.created || 0), Number(day.completed || 0)])
  );

  return (
    <div className="ops-snapshot-trend">
      <div className="ops-snapshot-trend-legend" aria-hidden="true">
        <span><span className="ops-snapshot-trend-key is-created" />Created</span>
        <span><span className="ops-snapshot-trend-key is-completed" />Completed</span>
      </div>
      <ol className="ops-snapshot-trend-days" aria-label="Work orders created and completed during the last seven days">
        {days.map(day => {
          const created = Number(day.created || 0);
          const completed = Number(day.completed || 0);
          const createdHeight = created > 0 ? Math.max(4, Math.round((created / maximum) * 50)) : 0;
          const completedHeight = completed > 0 ? Math.max(4, Math.round((completed / maximum) * 50)) : 0;

          return (
            <li
              key={day.date}
              className="ops-snapshot-trend-day"
              aria-label={`${formatDayLabel(day.date)}: ${created} created, ${completed} completed`}
            >
              <svg viewBox="0 0 24 58" aria-hidden="true" focusable="false">
                <path className="ops-snapshot-trend-baseline" d="M1 56.5H23" />
                <rect
                  className="ops-snapshot-trend-bar is-created"
                  x="3"
                  y={56 - createdHeight}
                  width="7"
                  height={createdHeight}
                  rx="2"
                />
                <rect
                  className="ops-snapshot-trend-bar is-completed"
                  x="14"
                  y={56 - completedHeight}
                  width="7"
                  height={completedHeight}
                  rx="2"
                />
              </svg>
              <span>{formatDayLabel(day.date)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="ops-snapshot-loading" role="status" aria-live="polite">
      <span className="ops-snapshot-loading-message">Loading operations snapshot…</span>
      <div className="ops-snapshot-loading-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="ops-snapshot-loading-card" key={index}>
            <span className="skeleton ops-snapshot-skeleton-label" />
            <span className="skeleton ops-snapshot-skeleton-value" />
            <span className="skeleton ops-snapshot-skeleton-note" />
          </div>
        ))}
      </div>
      <div className="ops-snapshot-loading-section" aria-hidden="true">
        <span className="skeleton ops-snapshot-skeleton-heading" />
        <span className="skeleton ops-snapshot-skeleton-line" />
        <span className="skeleton ops-snapshot-skeleton-line is-short" />
      </div>
      <div className="ops-snapshot-loading-section" aria-hidden="true">
        <span className="skeleton ops-snapshot-skeleton-heading" />
        <span className="skeleton ops-snapshot-skeleton-line" />
        <span className="skeleton ops-snapshot-skeleton-line is-short" />
      </div>
    </div>
  );
}

export default function OperationsSnapshotPanel({
  isOpen,
  onClose,
  triggerRef,
  user,
  isAuthLoading,
  navigate
}) {
  const [statistics, setStatistics] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const requestIdRef = useRef(0);
  const loadedOpenCycleRef = useRef(null);
  const userId = user?.id;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const loadStatistics = useCallback(async (forceRefresh = false) => {
    if (!userId) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError('');

    try {
      const config = forceRefresh ? { params: { _t: Date.now() } } : undefined;
      const response = await getDashboardStatistics(config);
      if (requestId === requestIdRef.current) {
        setStatistics(response.data);
      }
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(getErrorMessage(loadError, 'The operations snapshot could not be loaded.'));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    if (!isOpen) {
      loadedOpenCycleRef.current = null;
      return;
    }
    if (isAuthLoading || !userId || loadedOpenCycleRef.current === userId) return;
    loadedOpenCycleRef.current = userId;
    loadStatistics(false);
  }, [isAuthLoading, isOpen, loadStatistics, userId]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const triggerElement = triggerRef?.current;
    document.body.classList.add('ops-snapshot-open');
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusableElements = Array.from(panelRef.current.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('ops-snapshot-open');
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      } else {
        triggerElement?.focus();
      }
    };
  }, [isOpen, triggerRef]);

  const facilities = statistics?.facilities || {};
  const workOrders = statistics?.work_orders || {};
  const maintenance = statistics?.maintenance || {};
  const activeStatuses = useMemo(
    () => (statistics?.status_distribution || []).filter(item => ACTIVE_STATUS_KEYS.has(item.key)),
    [statistics]
  );
  const activePriorities = useMemo(
    () => (statistics?.priority_distribution || []).filter(item => Number(item.count || 0) > 0),
    [statistics]
  );
  const topTrades = statistics?.top_trades || [];
  const dailyActivity = statistics?.daily_activity || [];
  const activeTotal = Number(workOrders.active || 0);
  const roomCoverage = getPercent(facilities.rooms_located, facilities.rooms);
  const equipmentCoverage = getPercent(facilities.equipment_located, facilities.equipment);
  const workFlowChange = Number(workOrders.created_30_days || 0) - Number(workOrders.completed_30_days || 0);
  const maxTradeCount = Math.max(1, ...topTrades.map(item => Number(item.count || 0)));
  const hasAnyData = [
    facilities.sites,
    facilities.floorplans,
    facilities.rooms,
    facilities.equipment,
    facilities.open_tickets,
    workOrders.total,
    maintenance.active_pm_schedules
  ].some(value => Number(value || 0) > 0);

  const handleNavigate = path => {
    onCloseRef.current();
    navigate(path);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="ops-snapshot-backdrop"
        aria-hidden="true"
        onMouseDown={event => {
          if (event.target === event.currentTarget) onCloseRef.current();
        }}
      />
      <aside
        ref={panelRef}
        id="operations-snapshot-panel"
        className="ops-snapshot-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operations-snapshot-title"
        aria-describedby="operations-snapshot-subtitle"
      >
        <header className="ops-snapshot-header">
          <div className="ops-snapshot-title-wrap">
            <span className="ops-snapshot-title-icon" aria-hidden="true">
              <Activity size={20} />
            </span>
            <div>
              <span className="ops-snapshot-eyebrow">Portfolio overview</span>
              <h2 id="operations-snapshot-title">Operations snapshot</h2>
              <p id="operations-snapshot-subtitle">Workload, maintenance, and map readiness at a glance.</p>
            </div>
          </div>
          <div className="ops-snapshot-header-actions">
            <button
              type="button"
              className="btn btn-ghost btn-icon-md ops-snapshot-icon-button"
              onClick={() => loadStatistics(true)}
              disabled={!userId || isLoading}
              aria-label="Refresh operations snapshot"
              title="Refresh operations snapshot"
            >
              <RefreshCw size={18} className={isLoading ? 'spinning' : ''} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="btn btn-ghost btn-icon-md ops-snapshot-icon-button"
              onClick={() => onCloseRef.current()}
              aria-label="Close operations snapshot"
              title="Close operations snapshot"
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="ops-snapshot-body">
          {isAuthLoading ? (
            <LoadingState />
          ) : !user ? (
            <div className="ops-snapshot-state" role="status">
              <LogIn size={28} aria-hidden="true" />
              <h3>Sign in to view statistics</h3>
              <p>The operations snapshot includes protected work-order and maintenance information.</p>
              <button type="button" className="btn btn-primary" onClick={() => handleNavigate('/login')}>
                <LogIn size={16} />
                Sign in
              </button>
            </div>
          ) : isLoading && !statistics ? (
            <LoadingState />
          ) : error && !statistics ? (
            <div className="ops-snapshot-state is-error" role="alert">
              <AlertTriangle size={28} aria-hidden="true" />
              <h3>Statistics unavailable</h3>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary" onClick={() => loadStatistics(true)}>
                <RefreshCw size={16} />
                Try again
              </button>
            </div>
          ) : statistics && !hasAnyData ? (
            <div className="ops-snapshot-state" role="status">
              <Building2 size={28} aria-hidden="true" />
              <h3>No operational data yet</h3>
              <p>Facilities, work orders, maintenance schedules, and issue tickets will appear here as they are added.</p>
              <button type="button" className="btn btn-secondary" onClick={() => handleNavigate('/floorplans')}>
                <Layers3 size={16} />
                View floorplans
              </button>
            </div>
          ) : statistics ? (
            <>
              <div className="ops-snapshot-updated" role="status" aria-live="polite">
                <span>Updated {formatSnapshotTime(statistics.generated_at)}</span>
                {isLoading && <span className="ops-snapshot-refreshing">Refreshing…</span>}
              </div>

              {error && (
                <div className="ops-snapshot-inline-warning" role="alert">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>Showing the last available snapshot. {error}</span>
                </div>
              )}

              <section className="ops-snapshot-section" aria-labelledby="ops-now-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Current pressure</span>
                    <h3 id="ops-now-heading">Operations now</h3>
                  </div>
                  <span className="status-badge badge-neutral">All sites</span>
                </div>
                <div className="ops-snapshot-metric-grid">
                  <MetricCard
                    icon={ClipboardList}
                    label="Active work"
                    value={activeTotal}
                    note={`${formatCount(workOrders.total)} total orders`}
                  />
                  <MetricCard
                    icon={Clock3}
                    label="Overdue"
                    value={workOrders.overdue}
                    note={Number(workOrders.overdue || 0) === 0 ? 'No active orders past due' : `${getPercent(workOrders.overdue, activeTotal)}% of active work`}
                    tone={Number(workOrders.overdue || 0) > 0 ? 'danger' : 'success'}
                  />
                  <MetricCard
                    icon={UserRoundSearch}
                    label="Needs triage"
                    value={workOrders.needs_triage}
                    note="Pending review or assignment"
                    tone={Number(workOrders.needs_triage || 0) > 0 ? 'warning' : 'success'}
                  />
                  <MetricCard
                    icon={Siren}
                    label="Urgent"
                    value={workOrders.urgent}
                    note="Active urgent or critical priority"
                    tone={Number(workOrders.urgent || 0) > 0 ? 'danger' : 'success'}
                  />
                </div>
              </section>

              <section className="ops-snapshot-section" aria-labelledby="ops-flow-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Throughput</span>
                    <h3 id="ops-flow-heading">30-day work flow</h3>
                  </div>
                  <span className={`ops-snapshot-change is-${workFlowChange > 0 ? 'warning' : 'success'}`}>
                    {workFlowChange > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {workFlowChange === 0
                      ? 'Created = completed'
                      : workFlowChange > 0
                        ? `+${formatCount(workFlowChange)} created`
                        : `${formatCount(Math.abs(workFlowChange))} more completed`}
                  </span>
                </div>
                <div className="ops-snapshot-flow-summary">
                  <div>
                    <span>Created</span>
                    <strong>{formatCount(workOrders.created_30_days)}</strong>
                  </div>
                  <div>
                    <span>Completed</span>
                    <strong>{formatCount(workOrders.completed_30_days)}</strong>
                  </div>
                </div>
                <DailyActivityChart days={dailyActivity} />
              </section>

              <section className="ops-snapshot-section" aria-labelledby="ops-mix-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Backlog composition</span>
                    <h3 id="ops-mix-heading">Active work mix</h3>
                  </div>
                  <span className="ops-snapshot-section-total">{formatCount(activeTotal)} active</span>
                </div>
                {activeTotal > 0 ? (
                  <>
                    <div className="ops-snapshot-progress-list">
                      {activeStatuses.map(item => (
                        <ProgressRow
                          key={item.key}
                          label={item.label}
                          value={Number(item.count || 0)}
                          max={activeTotal}
                          tone={STATUS_TONES[item.key] || 'muted'}
                        />
                      ))}
                    </div>
                    {activePriorities.length > 0 && (
                      <div className="ops-snapshot-priority-list" aria-label="Active work by priority">
                        {activePriorities.map(item => (
                          <span key={item.key} className={`ops-snapshot-priority is-${PRIORITY_TONES[item.key] || 'muted'}`}>
                            {item.label}
                            <strong>{formatCount(item.count)}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="ops-snapshot-section-empty">No active work orders are in the backlog.</p>
                )}
              </section>

              <section className="ops-snapshot-section" aria-labelledby="ops-coverage-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Location readiness</span>
                    <h3 id="ops-coverage-heading">Map coverage</h3>
                  </div>
                  <MapPin size={18} aria-hidden="true" />
                </div>
                <div className="ops-snapshot-coverage-list">
                  <ProgressRow
                    label="Rooms placed"
                    value={Number(facilities.rooms_located || 0)}
                    max={Number(facilities.rooms || 0)}
                    detail={`${roomCoverage}% · ${formatCount(facilities.rooms_located)} of ${formatCount(facilities.rooms)}`}
                    tone={roomCoverage === 100 ? 'success' : 'primary'}
                  />
                  <ProgressRow
                    label="Equipment placed"
                    value={Number(facilities.equipment_located || 0)}
                    max={Number(facilities.equipment || 0)}
                    detail={`${equipmentCoverage}% · ${formatCount(facilities.equipment_located)} of ${formatCount(facilities.equipment)}`}
                    tone={equipmentCoverage === 100 ? 'success' : 'primary'}
                  />
                </div>
                <dl className="ops-snapshot-footprint-grid">
                  <div><Building2 size={15} aria-hidden="true" /><dt>Sites</dt><dd>{formatCount(facilities.sites)}</dd></div>
                  <div><Layers3 size={15} aria-hidden="true" /><dt>Floorplans</dt><dd>{formatCount(facilities.floorplans)}</dd></div>
                  <div><DoorOpen size={15} aria-hidden="true" /><dt>Rooms</dt><dd>{formatCount(facilities.rooms)}</dd></div>
                  <div><Package size={15} aria-hidden="true" /><dt>Equipment</dt><dd>{formatCount(facilities.equipment)}</dd></div>
                </dl>
              </section>

              <section className="ops-snapshot-section" aria-labelledby="ops-maintenance-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Forward view</span>
                    <h3 id="ops-maintenance-heading">Maintenance planning</h3>
                  </div>
                  <CalendarClock size={18} aria-hidden="true" />
                </div>
                <dl className="ops-snapshot-planning-list">
                  <div>
                    <span className="ops-snapshot-planning-icon is-primary"><Wrench size={15} /></span>
                    <dt>Active PM schedules</dt>
                    <dd>{formatCount(maintenance.active_pm_schedules)}</dd>
                  </div>
                  <div>
                    <span className="ops-snapshot-planning-icon is-info"><CalendarClock size={15} /></span>
                    <dt>PM due in 7 days</dt>
                    <dd>{formatCount(maintenance.pm_due_next_7_days)}</dd>
                  </div>
                  <div>
                    <span className={`ops-snapshot-planning-icon is-${Number(maintenance.pm_overdue || 0) > 0 ? 'danger' : 'success'}`}>
                      {Number(maintenance.pm_overdue || 0) > 0 ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}
                    </span>
                    <dt>PM schedules overdue</dt>
                    <dd>{formatCount(maintenance.pm_overdue)}</dd>
                  </div>
                  <div>
                    <span className={`ops-snapshot-planning-icon is-${Number(facilities.open_tickets || 0) > 0 ? 'warning' : 'success'}`}>
                      <Ticket size={15} />
                    </span>
                    <dt>Open issue tickets</dt>
                    <dd>{formatCount(facilities.open_tickets)}</dd>
                  </div>
                </dl>
              </section>

              <section className="ops-snapshot-section" aria-labelledby="ops-trades-heading">
                <div className="ops-snapshot-section-heading">
                  <div>
                    <span className="ops-snapshot-eyebrow">Dispatch demand</span>
                    <h3 id="ops-trades-heading">Workload by trade</h3>
                  </div>
                </div>
                {topTrades.length > 0 ? (
                  <div className="ops-snapshot-trade-list">
                    {topTrades.map(item => (
                      <button
                        key={item.trade}
                        type="button"
                        className="ops-snapshot-trade-row"
                        onClick={() => handleNavigate(`/work-orders?trade=${encodeURIComponent(item.trade)}`)}
                        title={`View active ${item.trade} work orders`}
                      >
                        <span className="ops-snapshot-trade-meta">
                          <span>{item.trade}</span>
                          <strong>{formatCount(item.count)}</strong>
                        </span>
                        <progress value={Number(item.count || 0)} max={maxTradeCount} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="ops-snapshot-section-empty">No active work is assigned to a trade.</p>
                )}
              </section>
            </>
          ) : null}
        </div>

        {user && statistics && hasAnyData && (
          <footer className="ops-snapshot-footer">
            <button type="button" className="btn btn-secondary" onClick={() => handleNavigate('/tickets')}>
              <Ticket size={16} />
              Issue tickets
            </button>
            <button type="button" className="btn btn-primary" onClick={() => handleNavigate('/work-orders')}>
              <ClipboardList size={16} />
              View work orders
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
