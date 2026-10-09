import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarCheck2, CalendarDays, CalendarPlus2, ChevronLeft,
  ChevronRight, ClockAlert, FilePlus2, MapPin, RefreshCw, UserRound,
} from 'lucide-react';
import { getErrorMessage, getPMCalendar } from '../api';
import './WorkOrderCalendar.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_META = {
  'wo-opened': { label: 'Work order opened', shortLabel: 'Opened', Icon: FilePlus2 },
  'wo-due': { label: 'Work order due', shortLabel: 'WO due', Icon: ClockAlert },
  'pm-issued': { label: 'PM work order issues', shortLabel: 'PM issue', Icon: CalendarPlus2 },
  'pm-due': { label: 'PM work order due', shortLabel: 'PM due', Icon: CalendarCheck2 },
};

function dateKey(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayDate(key) {
  const parsed = new Date(`${key}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function displayTime(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function workOrderLocation(workOrder) {
  const locationNames = [
    ...(workOrder.rooms || []).map(room => `Room ${room.name}`),
    ...(workOrder.equipment || []).map(item => item.name || item.description),
  ].filter(Boolean);
  return locationNames[0]
    || workOrder.location_details
    || workOrder.floorplan_name
    || workOrder.site_name
    || 'No location';
}

function pmLocation(occurrence) {
  return [occurrence.site_name, occurrence.floorplan_name].filter(Boolean).join(' · ') || 'No location';
}

function matchesPMSearch(occurrence, query) {
  const filter = String(query || '').trim().toLowerCase();
  if (!filter) return true;

  const searchableText = [
    occurrence.title,
    occurrence.category,
    occurrence.trade,
    occurrence.priority,
    occurrence.task_code,
    occurrence.site_name,
    occurrence.floorplan_name,
    ...(occurrence.assignee_names || []),
    ...(occurrence.assignee_usernames || []),
    (occurrence.assignee_usernames || []).length ? 'assigned active PM' : 'unassigned active PM',
  ].filter(Boolean).join(' ').toLowerCase();

  if (filter.includes('*') || filter.includes('?')) {
    const escaped = filter.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i').test(searchableText);
  }

  if (searchableText.includes(filter)) return true;

  const normalizedText = searchableText.replace(/[-_/:,]/g, ' ').replace(/\s+/g, ' ');
  const normalizedFilter = filter.replace(/[-_/:,]/g, ' ').replace(/\s+/g, ' ');
  if (normalizedText.includes(normalizedFilter)) return true;

  const stopWords = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'the', 'a', 'an', 'or', 'and', 'with', 'by']);
  const rawTokens = filter.replace(/[,;:]/g, ' ').split(/\s+/).filter(Boolean);
  const meaningfulTokens = rawTokens.filter(token => !stopWords.has(token));
  const tokens = meaningfulTokens.length ? meaningfulTokens : rawTokens;
  return tokens.every(token => normalizedText.includes(token));
}

function matchesPMFilters(occurrence, filters) {
  const usernames = occurrence.assignee_usernames || [];
  if (filters.trade !== 'all' && occurrence.trade !== filters.trade) return false;
  if (filters.category !== 'all' && occurrence.category !== filters.category) return false;
  if (filters.priority !== 'all' && occurrence.priority !== filters.priority) return false;

  if (filters.technician !== 'all') {
    if (filters.technician === 'Unassigned') {
      if (usernames.length > 0) return false;
    } else if (!usernames.includes(filters.technician)) {
      return false;
    }
  }

  if (filters.status !== 'all') {
    if (filters.status === 'assigned') {
      if (usernames.length === 0) return false;
    } else if (filters.status !== 'open') {
      return false;
    }
  }

  return matchesPMSearch(occurrence, filters.search);
}

function matchesPMDateFilter(event, filter, now) {
  if (filter === 'all') return true;
  const eventDate = new Date(event.date);
  if (Number.isNaN(eventDate.getTime())) return false;
  if (filter === 'today') return eventDate.toDateString() === now.toDateString();
  if (filter === 'this_week') return eventDate >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (filter === 'this_month') {
    return eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear();
  }
  if (filter === 'past_30') return eventDate >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (filter === 'overdue') return event.kind === 'pm-due' && eventDate < now;
  return true;
}

export default function WorkOrderCalendar({
  workOrders = [],
  statusFilter = 'all',
  priorityFilter = 'all',
  categoryFilter = 'all',
  tradeFilter = 'all',
  techFilter = 'all',
  dateFilter = 'all',
  searchQuery = '',
  onOpenWorkOrder,
  onOpenPMSchedule,
}) {
  const today = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: today.getFullYear(), month: today.getMonth(),
  }));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const [sourceMode, setSourceMode] = useState('all');
  const [pmRequest, setPMRequest] = useState({ key: null, occurrences: [], error: '' });
  const [retryCount, setRetryCount] = useState(0);

  const monthStart = useMemo(
    () => new Date(visibleMonth.year, visibleMonth.month, 1),
    [visibleMonth],
  );
  const monthEnd = useMemo(
    () => new Date(visibleMonth.year, visibleMonth.month + 1, 1),
    [visibleMonth],
  );
  const monthName = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(visibleMonth.year, visibleMonth.month + 1, 0).getDate();
  const firstDayOfWeek = monthStart.getDay();
  const requestKey = `${visibleMonth.year}-${visibleMonth.month}-${retryCount}`;
  const pmLoading = pmRequest.key !== requestKey;
  const pmOccurrences = useMemo(
    () => (pmLoading ? [] : pmRequest.occurrences),
    [pmLoading, pmRequest.occurrences],
  );
  const pmError = pmLoading ? '' : pmRequest.error;

  useEffect(() => {
    let cancelled = false;
    getPMCalendar(monthStart.toISOString(), monthEnd.toISOString())
      .then(response => {
        if (!cancelled) {
          setPMRequest({ key: requestKey, occurrences: response.data?.occurrences || [], error: '' });
        }
      })
      .catch(error => {
        if (!cancelled) {
          setPMRequest({
            key: requestKey,
            occurrences: [],
            error: getErrorMessage(error, 'PM schedule forecast could not be loaded.'),
          });
        }
      });
    return () => { cancelled = true; };
  }, [monthEnd, monthStart, requestKey]);

  const events = useMemo(() => {
    const nextEvents = [];
    const filters = {
      status: statusFilter,
      priority: priorityFilter,
      category: categoryFilter,
      trade: tradeFilter,
      technician: techFilter,
      search: searchQuery,
    };
    workOrders.forEach(workOrder => {
      if (workOrder.created_at) {
        nextEvents.push({
          id: `wo-${workOrder.id}-opened`, kind: 'wo-opened', source: 'work-order',
          date: workOrder.created_at, title: workOrder.title, workOrder,
          reference: workOrder.order_number, status: workOrder.status,
          location: workOrderLocation(workOrder),
          assignees: (workOrder.assignees || []).map(user => user.full_name || user.username),
        });
      }
      if (workOrder.due_date) {
        nextEvents.push({
          id: `wo-${workOrder.id}-due`, kind: 'wo-due', source: 'work-order',
          date: workOrder.due_date, title: workOrder.title, workOrder,
          reference: workOrder.order_number, status: workOrder.status,
          location: workOrderLocation(workOrder),
          assignees: (workOrder.assignees || []).map(user => user.full_name || user.username),
        });
      }
    });
    pmOccurrences.forEach(occurrence => {
      if (!matchesPMFilters(occurrence, filters)) return;
      const common = {
        source: 'pm', title: occurrence.title, occurrence,
        reference: occurrence.task_code || `PM-${occurrence.schedule_id}`,
        status: 'Active PM', location: pmLocation(occurrence),
        assignees: occurrence.assignee_names || [],
      };
      nextEvents.push({
        ...common, id: `pm-${occurrence.schedule_id}-${occurrence.occurrence_number}-issued`,
        kind: 'pm-issued', date: occurrence.issue_datetime,
      });
      nextEvents.push({
        ...common, id: `pm-${occurrence.schedule_id}-${occurrence.occurrence_number}-due`,
        kind: 'pm-due', date: occurrence.due_datetime,
      });
    });
    return nextEvents
      .filter(event => dateKey(event.date))
      .filter(event => event.source !== 'pm' || matchesPMDateFilter(event, dateFilter, today))
      .sort((left, right) => new Date(left.date) - new Date(right.date));
  }, [categoryFilter, dateFilter, pmOccurrences, priorityFilter, searchQuery, statusFilter, techFilter, today, tradeFilter, workOrders]);

  const visibleEvents = useMemo(() => events.filter(event => {
    if (sourceMode === 'work-orders') return event.source === 'work-order';
    if (sourceMode === 'pm') return event.source === 'pm';
    return true;
  }), [events, sourceMode]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map();
    visibleEvents.forEach(event => {
      const key = dateKey(event.date);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(event);
    });
    return grouped;
  }, [visibleEvents]);

  const monthEvents = useMemo(() => visibleEvents.filter(event => {
    const value = new Date(event.date);
    return value >= monthStart && value < monthEnd;
  }), [monthEnd, monthStart, visibleEvents]);
  const workOrderEventCount = monthEvents.filter(event => event.source === 'work-order').length;
  const pmEventCount = monthEvents.filter(event => event.source === 'pm').length;
  const selectedEvents = eventsByDate.get(selectedDate) || [];

  const moveMonth = offset => {
    const next = new Date(visibleMonth.year, visibleMonth.month + offset, 1);
    setVisibleMonth({ year: next.getFullYear(), month: next.getMonth() });
    const todayIsNext = today.getFullYear() === next.getFullYear() && today.getMonth() === next.getMonth();
    setSelectedDate(todayIsNext ? dateKey(today) : dateKey(next));
  };

  const jumpToToday = () => {
    setVisibleMonth({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDate(dateKey(today));
  };

  const openEvent = event => {
    setSelectedDate(dateKey(event.date));
    if (event.source === 'work-order') onOpenWorkOrder?.(event.workOrder);
    else onOpenPMSchedule?.(event.occurrence);
  };

  return (
    <section className="wo-cal-panel glass-panel" aria-labelledby="work-order-calendar-heading">
      <div className="wo-cal-toolbar">
        <div className="wo-cal-heading">
          <span className="wo-cal-heading-icon"><CalendarDays size={18} /></span>
          <div>
            <h2 id="work-order-calendar-heading">Work order calendar</h2>
            <p>Opened and due work orders with active PM issue and due projections.</p>
          </div>
        </div>

        <div className="wo-cal-source-switch" role="group" aria-label="Calendar sources">
          {[
            ['all', 'All'], ['work-orders', 'Work orders'], ['pm', 'PM schedules'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={sourceMode === value ? 'active' : ''}
              onClick={() => setSourceMode(value)}
              aria-pressed={sourceMode === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="wo-cal-nav">
        <div className="wo-cal-nav-buttons">
          <button type="button" className="btn btn-ghost btn-icon-xs" onClick={() => moveMonth(-1)} aria-label="Previous month" title="Previous month">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon-xs" onClick={() => moveMonth(1)} aria-label="Next month" title="Next month">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={jumpToToday}>Today</button>
        </div>
        <strong className="wo-cal-month-name">{monthName}</strong>
        <div className="wo-cal-month-counts" aria-live="polite">
          <span>{workOrderEventCount} work order events</span>
          <span>{pmEventCount} PM events</span>
        </div>
      </div>

      {pmLoading && sourceMode !== 'work-orders' && (
        <div className="wo-cal-notice" role="status"><RefreshCw className="spinning" size={15} /> Loading PM forecast…</div>
      )}
      {pmError && sourceMode !== 'work-orders' && (
        <div className="wo-cal-notice is-error" role="alert">
          <AlertTriangle size={15} />
          <span>{pmError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetryCount(count => count + 1)}>Retry</button>
        </div>
      )}

      <div className="wo-cal-grid-header" role="row">
        {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
      </div>
      <div className="wo-cal-grid" role="grid" aria-label={`${monthName} work orders and preventive maintenance`}>
        {Array.from({ length: firstDayOfWeek }).map((_, index) => (
          <div key={`blank-${index}`} className="wo-cal-cell is-empty" role="gridcell" aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, index) => {
          const day = index + 1;
          const key = dateKey(new Date(visibleMonth.year, visibleMonth.month, day));
          const dayEvents = eventsByDate.get(key) || [];
          const isToday = key === dateKey(today);
          const isSelected = key === selectedDate;
          return (
            <div
              key={key}
              className={`wo-cal-cell ${dayEvents.length ? 'has-events' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
              role="gridcell"
              onClick={() => setSelectedDate(key)}
            >
              <button
                type="button"
                className="wo-cal-day-button"
                onClick={() => setSelectedDate(key)}
                aria-label={`${displayDate(key)}${dayEvents.length ? `, ${dayEvents.length} events` : ', no events'}`}
                aria-pressed={isSelected}
              >
                {day}
              </button>
              <div className="wo-cal-cell-events">
                {dayEvents.slice(0, 3).map(event => {
                  const meta = EVENT_META[event.kind];
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`wo-cal-event-chip ${event.kind}`}
                      onClick={() => openEvent(event)}
                      title={`${meta.label}: ${event.title}`}
                      aria-label={`${meta.label}: ${event.title}`}
                    >
                      <meta.Icon size={11} />
                      <span className="wo-cal-event-text">{event.reference} · {event.title}</span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <button type="button" className="wo-cal-more" onClick={() => setSelectedDate(key)}>
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="wo-cal-legend" aria-label="Calendar legend">
        {Object.entries(EVENT_META).map(([kind, meta]) => (
          <span key={kind} className={kind}><meta.Icon size={12} /> {meta.shortLabel}</span>
        ))}
      </div>

      <div className="wo-cal-agenda" aria-live="polite">
        <div className="wo-cal-agenda-heading">
          <div>
            <span className="wo-cal-eyebrow">Selected day</span>
            <h3>{displayDate(selectedDate)}</h3>
          </div>
          <span>{selectedEvents.length} {selectedEvents.length === 1 ? 'event' : 'events'}</span>
        </div>
        {selectedEvents.length === 0 ? (
          <div className="wo-cal-agenda-empty">
            <CalendarDays size={24} />
            <strong>No work scheduled</strong>
            <span>Select another day, change the filters, or change the calendar source.</span>
          </div>
        ) : (
          <div className="wo-cal-agenda-list">
            {selectedEvents.map(event => {
              const meta = EVENT_META[event.kind];
              return (
                <button key={event.id} type="button" className={`wo-cal-agenda-item ${event.kind}`} onClick={() => openEvent(event)}>
                  <span className="wo-cal-agenda-icon"><meta.Icon size={16} /></span>
                  <span className="wo-cal-agenda-main">
                    <span className="wo-cal-agenda-title-row">
                      <strong>{event.title}</strong>
                      <span>{event.reference}</span>
                    </span>
                    <span className="wo-cal-agenda-meta">
                      <span>{meta.label} at {displayTime(event.date)}</span>
                      <span><MapPin size={12} /> {event.location}</span>
                      <span><UserRound size={12} /> {event.assignees.length ? event.assignees.join(', ') : 'Unassigned'}</span>
                    </span>
                  </span>
                  <span className="wo-cal-agenda-status">{event.status?.replaceAll('_', ' ')}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
