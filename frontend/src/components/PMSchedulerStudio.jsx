import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Building2, Calendar, CalendarDays, Check, CheckCircle2, CircleDot,
  ChevronLeft, ChevronRight, Clock3, Edit3, Gauge, ListChecks, Pause, Play, Plus,
  RefreshCw, RotateCcw, Save, Search, Trash2, UserRound, Wrench, X,
} from 'lucide-react';
import {
  createPMSchedule, deletePMSchedule, getAllEquipment, getAllRooms,
  getAssignableUsers, getEquipment, getErrorMessage, getFloorplans,
  getPMSchedules, getRooms, getSites, previewPMSchedule, triggerPMSchedule,
  updatePMSchedule,
} from '../api';
import AssetsOwnershipSection from './AssetsOwnershipSection';
import TaskSelectModal from './TaskSelectModal';
import TaskTemplateLinkSelector from './TaskTemplateLinkSelector';
import './PMSchedulerStudio.css';

const WEEKDAYS = [
  ['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'],
  ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun'],
];

const PRESETS = [
  { id: 'weekly', label: 'Weekly', frequency: 'weekly', interval: 1 },
  { id: 'biweekly', label: 'Bi-weekly', frequency: 'weekly', interval: 2 },
  { id: 'monthly', label: 'Monthly', frequency: 'monthly', interval: 1 },
  { id: 'quarterly', label: 'Quarterly', frequency: 'monthly', interval: 3 },
  { id: 'semiannual', label: 'Semi-annual', frequency: 'monthly', interval: 6 },
  { id: 'annual', label: 'Annual', frequency: 'monthly', interval: 12 },
];

const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];
const REGISTRY_PAGE_SIZE = 50;
const TIMEZONES = [
  'UTC',
  'America/St_Johns',
  'America/Halifax',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Winnipeg',
  'America/Regina',
  'America/Denver',
  'America/Edmonton',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Tijuana',
  'America/Anchorage',
  'America/Adak',
  'Pacific/Honolulu',
  'America/Mexico_City',
];


function localDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function emptyRule() {
  return {
    frequency: 'monthly', interval: 1, start_date: localDate(), time_of_day: '08:00',
    timezone: browserTimezone(), weekly_days: ['MO'], monthly_type: 'exact-day',
    month_day: 1, ordinal: 'first', ordinal_day: 'MO', non_working_day_rule: 'none',
    due_after_issued_days: 3, end_rule: 'never',
  };
}

function emptyForm() {
  return {
    id: null, title: '', description: '', category: 'Preventive Maintenance', priority: 'medium',
    trade: '', taskId: null, taskCode: '', taskDescription: '',
    recurrence: emptyRule(), isActive: true,
    siteId: '', floorplanId: '', equipmentIds: [], roomIds: [], assigneeIds: [],
    estimatedHours: '1.5', checklistItems: [],
  };
}

function scheduleToForm(schedule) {
  return {
    id: schedule.id,
    title: schedule.title || '',
    description: schedule.description || '',
    category: schedule.category || 'Preventive Maintenance',
    trade: schedule.trade || '',
    taskId: schedule.task_id || null,
    taskCode: schedule.task_code || '',
    taskDescription: schedule.task_description || '',
    priority: schedule.priority || 'medium',
    recurrence: schedule.recurrence_rule ? { ...emptyRule(), ...schedule.recurrence_rule } : emptyRule(),
    isActive: schedule.is_active,
    siteId: schedule.site_id ? String(schedule.site_id) : '',
    floorplanId: schedule.floorplan_id ? String(schedule.floorplan_id) : '',
    equipmentIds: (schedule.equipment || []).map(item => item.id),
    roomIds: (schedule.rooms || []).map(item => item.id),
    assigneeIds: (schedule.assignees || []).map(item => item.id),
    estimatedHours: String(schedule.estimated_hours || 1),
    checklistItems: schedule.checklist_items || [],
  };
}

function applyTaskDefaults(form, task, initialItem = null, initialItemType = null) {
  let nextForm = { ...form };
  if (!task) {
    nextForm = { ...nextForm, taskId: null, taskCode: '', taskDescription: '' };
  } else {
    const linkedItems = [...(task.equipment || []), ...(task.rooms || [])];
    const siteIds = [...new Set(linkedItems.map(item => item.site_id).filter(Boolean))];
    const floorplanIds = [...new Set(linkedItems.map(item => item.floorplan_id).filter(Boolean))];
    nextForm = {
      ...nextForm,
      taskId: task.id,
      taskCode: task.code || '',
      taskDescription: task.description || '',
      title: task.description || nextForm.title,
      description: task.pm_task_sheet || task.description || nextForm.description,
      category: task.category || nextForm.category,
      trade: task.trade || '',
      estimatedHours: String(task.estimated_hours || 1),
      checklistItems: task.checklist_items || [],
      equipmentIds: (task.equipment || []).map(item => item.id),
      roomIds: (task.rooms || []).map(item => item.id),
      siteId: siteIds.length === 1 ? String(siteIds[0]) : '',
      floorplanId: floorplanIds.length === 1 ? String(floorplanIds[0]) : '',
    };
  }

  if (initialItem) {
    if (initialItemType === 'equipment') {
      if (!nextForm.equipmentIds.includes(initialItem.id)) {
        nextForm.equipmentIds = [...nextForm.equipmentIds, initialItem.id];
      }
    } else if (initialItemType === 'room') {
      if (!nextForm.roomIds.includes(initialItem.id)) {
        nextForm.roomIds = [...nextForm.roomIds, initialItem.id];
      }
    }
    if (initialItem.site_id && !nextForm.siteId) {
      nextForm.siteId = String(initialItem.site_id);
    }
    if (initialItem.floorplan_id && !nextForm.floorplanId) {
      nextForm.floorplanId = String(initialItem.floorplan_id);
    }
  }

  return nextForm;
}

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function describeRule(rule) {
  if (rule.frequency === 'daily') return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
  if (rule.frequency === 'weekly') return `${rule.interval === 1 ? 'Every week' : `Every ${rule.interval} weeks`} on ${(rule.weekly_days || []).join(', ')}`;
  const cadence = rule.interval === 1 ? 'Every month' : rule.interval === 3 ? 'Quarterly' : rule.interval === 6 ? 'Semi-annually' : rule.interval === 12 ? 'Annually' : `Every ${rule.interval} months`;
  if (rule.monthly_type === 'last-day') return `${cadence} on the last day`;
  if (rule.monthly_type === 'relative-weekday') return `${cadence} on the ${rule.ordinal} ${rule.ordinal_day}`;
  return `${cadence} on day ${rule.month_day}`;
}

function getScheduleSearchText(schedule) {
  const linkedItems = [
    ...(schedule.equipment || []),
    ...(schedule.rooms || []),
  ];
  const values = [
    schedule.id,
    schedule.title,
    schedule.description,
    schedule.category,
    schedule.trade,
    schedule.task_code,
    schedule.task_description,
    schedule.site_name,
    schedule.floorplan_name,
    ...linkedItems.flatMap(item => [item.name, item.description, item.site_name, item.floorplan_name]),
    ...(schedule.assignees || []).flatMap(item => [item.full_name, item.username, item.trade]),
  ];
  return values.filter(value => value !== null && value !== undefined && value !== '').join(' ').toLocaleLowerCase();
}

function getScheduleSiteIds(schedule) {
  return new Set([
    schedule.site_id,
    ...(schedule.equipment || []).map(item => item.site_id),
    ...(schedule.rooms || []).map(item => item.site_id),
  ].filter(value => value !== null && value !== undefined && value !== '').map(String));
}

function getScheduleCategory(schedule) {
  return String(schedule.category || 'Preventive Maintenance').trim() || 'Preventive Maintenance';
}

function ScheduleRegistry({
  schedules,
  sites,
  loading,
  error,
  canEdit,
  initialSearch,
  onCreate,
  onEdit,
  onToggle,
  onRun,
  onDelete,
  onRetry,
  searchInputRef,
}) {
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const totalSchedules = schedules.length;
  const siteOptions = useMemo(() => {
    const sitesById = new Map();
    const addSite = (id, name) => {
      if (id === null || id === undefined || id === '') return;
      const normalizedId = String(id);
      const normalizedName = String(name || `Site #${id}`).trim();
      if (!sitesById.has(normalizedId) || name) sitesById.set(normalizedId, normalizedName);
    };
    sites.forEach(site => addSite(site.id, site.name));
    schedules.forEach(schedule => {
      addSite(schedule.site_id, schedule.site_name);
      [...(schedule.equipment || []), ...(schedule.rooms || [])].forEach(item => addSite(item.site_id, item.site_name));
    });
    return [...sitesById.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [schedules, sites]);
  const categoryOptions = useMemo(() => {
    const categoriesByKey = new Map();
    schedules.forEach(schedule => {
      const category = getScheduleCategory(schedule);
      const key = category.toLocaleLowerCase();
      if (!categoriesByKey.has(key)) categoriesByKey.set(key, category);
    });
    return [...categoriesByKey.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [schedules]);
  const filteredSchedules = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    return schedules.filter(schedule => {
      if (normalizedQuery && !getScheduleSearchText(schedule).includes(normalizedQuery)) return false;
      if (categoryFilter !== 'all' && getScheduleCategory(schedule).toLocaleLowerCase() !== categoryFilter) return false;
      if (statusFilter === 'active' && !schedule.is_active) return false;
      if (statusFilter === 'paused' && schedule.is_active) return false;
      if (priorityFilter !== 'all' && String(schedule.priority || 'medium').toLocaleLowerCase() !== priorityFilter) return false;
      if (siteFilter !== 'all' && !getScheduleSiteIds(schedule).has(siteFilter)) return false;
      return true;
    });
  }, [categoryFilter, priorityFilter, schedules, searchQuery, siteFilter, statusFilter]);
  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setPriorityFilter('all');
    setSiteFilter('all');
    setCurrentPage(1);
  };
  const hasActiveFilters = Boolean(searchQuery.trim()) || categoryFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || siteFilter !== 'all';
  const countLabel = filteredSchedules.length === totalSchedules
    ? `${totalSchedules} maintenance plan${totalSchedules === 1 ? '' : 's'}`
    : `${filteredSchedules.length} of ${totalSchedules} maintenance plans`;
  const totalPages = Math.max(1, Math.ceil(filteredSchedules.length / REGISTRY_PAGE_SIZE));
  const visiblePage = Math.min(currentPage, totalPages);
  const pageStart = (visiblePage - 1) * REGISTRY_PAGE_SIZE;
  const visibleSchedules = filteredSchedules.slice(pageStart, pageStart + REGISTRY_PAGE_SIZE);
  const pageEnd = Math.min(pageStart + visibleSchedules.length, filteredSchedules.length);

  return (
    <section className="pm-registry" aria-label="PM schedule registry">
      <div className="pm-registry-heading">
        <div>
          <span className="pm-eyebrow">Schedule registry</span>
          <h3>{countLabel}</h3>
        </div>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={onCreate}><Plus size={15} /> New plan</button>}
      </div>
      <div className="pm-registry-toolbar-row filter-toolbar-row" role="search" aria-label="Search and filter PM schedules">
        <div className="pm-search-box-wrap filter-search-control">
          <Search className="pm-search-icon filter-search-icon" size={16} aria-hidden="true" />
          <input
            type="search"
            ref={searchInputRef}
            className="input-field filter-control"
            value={searchQuery}
            onChange={event => { setSearchQuery(event.target.value); setCurrentPage(1); }}
            placeholder="Search plans, assets, rooms, or assignees..."
            aria-label="Search PM schedules"
          />
          {searchQuery && <button type="button" className="filter-clear-btn pm-search-clear-btn" onClick={() => { setSearchQuery(''); setCurrentPage(1); }} aria-label="Clear PM schedule search"><X size={14} /></button>}
        </div>
        <select className="input-field filter-control pm-registry-select" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setCurrentPage(1); }} aria-label="Filter PM schedules by task category">
          <option value="all">All task categories</option>
          {categoryOptions.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select className="input-field filter-control pm-registry-select" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setCurrentPage(1); }} aria-label="Filter PM schedules by status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        <select className="input-field filter-control pm-registry-select" value={priorityFilter} onChange={event => { setPriorityFilter(event.target.value); setCurrentPage(1); }} aria-label="Filter PM schedules by priority">
          <option value="all">All priorities</option>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="urgent">Urgent priority</option>
        </select>
        <select className="input-field filter-control pm-registry-select" value={siteFilter} onChange={event => { setSiteFilter(event.target.value); setCurrentPage(1); }} aria-label="Filter PM schedules by site">
          <option value="all">All sites</option>
          {siteOptions.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
        {hasActiveFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>}
      </div>
      {loading ? (
        <div className="pm-empty" role="status"><RefreshCw className="pm-spin" size={22} /> <strong>Loading schedules</strong><span>Retrieving preventive maintenance plans.</span></div>
      ) : error ? (
        <div className="pm-empty pm-empty-error" role="alert">
          <AlertTriangle size={30} />
          <strong>Unable to load maintenance plans</strong>
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}><RefreshCw size={14} /> Retry</button>
        </div>
      ) : filteredSchedules.length === 0 ? (
        <div className="pm-empty">
          <CalendarDays size={32} />
          <strong>{totalSchedules === 0 ? 'No maintenance plans yet' : 'No maintenance plans match these filters'}</strong>
          <span>{totalSchedules === 0 ? 'Build a reusable work template and verify every occurrence before activation.' : 'Try a different search or clear the current filters.'}</span>
          {hasActiveFilters && <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <div className="pm-schedule-list">
          {visibleSchedules.map(schedule => {
            const taskCategory = getScheduleCategory(schedule);
            const recurrence = schedule.recurrence_rule ? describeRule(schedule.recurrence_rule) : `Custom recurrence: ${schedule.cron_expression}`;
            const taskDescription = schedule.task_description?.trim();

            return (
              <article className={`pm-schedule-card ${schedule.is_active ? '' : 'is-paused'}`} key={schedule.id}>
                <div className="pm-schedule-main">
                  <div className="pm-card-topline">
                    {schedule.task_code && <span className="pm-task-code">{schedule.task_code}</span>}
                    <span className="pm-task-category">{taskCategory}</span>
                    <span className={`badge badge-${schedule.priority === 'urgent' ? 'danger' : schedule.priority === 'high' ? 'warning' : 'secondary'}`}>{schedule.priority}</span>
                    <span className={`pm-status ${schedule.is_active ? 'active' : ''}`}>{schedule.is_active ? 'Active' : 'Paused'}</span>
                  </div>
                  <h4>{schedule.title}</h4>
                  {taskDescription && taskDescription !== schedule.title && <p className="pm-task-reference"><ListChecks size={13} /> {taskDescription}</p>}
                  <p className="pm-schedule-recurrence">{recurrence}</p>
                  <div className="pm-card-meta">
                    <span><Clock3 size={13} /> Next: {formatDateTime(schedule.next_run_at)}</span>
                    {schedule.site_name && <span><Building2 size={13} /> {schedule.site_name}</span>}
                    {schedule.equipment?.length > 0 && <span><Wrench size={13} /> {schedule.equipment.length} equipment</span>}
                    {schedule.rooms?.length > 0 && <span><Building2 size={13} /> {schedule.rooms.length} rooms</span>}
                    {schedule.assignees?.length > 0 && <span><UserRound size={13} /> {schedule.assignees.map(item => item.full_name || item.username).join(', ')}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="pm-card-actions">
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => onEdit(schedule)}><Edit3 size={13} /> Edit</button>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => onRun(schedule)}><Play size={13} /> Run now</button>
                    <button type="button" className="btn btn-ghost btn-icon-xs" title={schedule.is_active ? 'Pause schedule' : 'Activate schedule'} aria-label={schedule.is_active ? 'Pause schedule' : 'Activate schedule'} onClick={() => onToggle(schedule)}>{schedule.is_active ? <Pause size={14} /> : <Play size={14} />}</button>
                    <button type="button" className="btn btn-ghost btn-icon-xs text-danger" title="Delete schedule" aria-label="Delete schedule" onClick={() => onDelete(schedule)}><Trash2 size={14} /></button>
                  </div>
                )}
              </article>
            );
          })}
          {totalPages > 1 && <nav className="pm-registry-pagination" aria-label="PM schedule registry pages"><span>Showing {pageStart + 1}–{pageEnd} of {filteredSchedules.length}</span><div><button type="button" className="btn btn-ghost btn-icon-sm" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={visiblePage === 1} aria-label="Previous schedule page"><ChevronLeft size={16} /></button><span>Page {visiblePage} of {totalPages}</span><button type="button" className="btn btn-ghost btn-icon-sm" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={visiblePage === totalPages} aria-label="Next schedule page"><ChevronRight size={16} /></button></div></nav>}
        </div>
      )}
    </section>
  );
}

function RecurrenceEditor({ form, setForm, preview, previewError, previewing, summaryRef }) {
  const rule = form.recurrence;
  const setRule = update => setForm(current => ({ ...current, recurrence: { ...current.recurrence, ...update } }));
  const applyPreset = preset => setRule({ frequency: preset.frequency, interval: preset.interval });
  const toggleWeekday = day => {
    const selected = rule.weekly_days.includes(day);
    if (selected && rule.weekly_days.length === 1) return;
    setRule({ weekly_days: selected ? rule.weekly_days.filter(value => value !== day) : [...rule.weekly_days, day] });
  };

  return (
    <section className="pm-panel">
      <div className="pm-section-title"><Calendar size={17} aria-hidden="true" /><div><span>Recurrence & cadence</span><small>Configure pattern, frequency, timing, and weekend rules.</small></div></div>
      <div className="pm-preset-row" aria-label="Recurrence presets">{PRESETS.map(preset => {
        const isActive = rule.frequency === preset.frequency && rule.interval === preset.interval;
        return <button type="button" key={preset.id} onClick={() => applyPreset(preset)} className={isActive ? 'active' : ''} aria-pressed={isActive}>{preset.label}</button>;
      })}</div>
      <div className="pm-form-grid three">
        <div className="input-group"><label htmlFor="pm-frequency">Frequency unit</label><select id="pm-frequency" className="input-field" value={rule.frequency} onChange={event => setRule({ frequency: event.target.value })}><option value="daily">Days</option><option value="weekly">Weeks</option><option value="monthly">Months</option></select></div>
        <div className="input-group"><label htmlFor="pm-interval">Repeat every</label><input id="pm-interval" className="input-field" type="number" min="1" max="99" value={rule.interval} onChange={event => setRule({ interval: Math.max(1, Number(event.target.value) || 1) })} /></div>
        <div className="input-group"><label htmlFor="pm-issue-time">Issue time</label><input id="pm-issue-time" className="input-field" type="time" value={rule.time_of_day} onChange={event => setRule({ time_of_day: event.target.value })} /></div>
      </div>
      {rule.frequency === 'weekly' && <fieldset className="pm-weekday-fieldset"><legend>Issue weekdays</legend><div className="pm-weekdays">{WEEKDAYS.map(([value, label]) => {
        const isActive = rule.weekly_days.includes(value);
        return <button type="button" key={value} className={isActive ? 'active' : ''} onClick={() => toggleWeekday(value)} aria-pressed={isActive}>{label}</button>;
      })}</div></fieldset>}
      {rule.frequency === 'monthly' && (
        <div className="pm-month-rule">
          <div className="pm-segmented" role="group" aria-label="Monthly recurrence type"><button type="button" className={rule.monthly_type === 'exact-day' ? 'active' : ''} aria-pressed={rule.monthly_type === 'exact-day'} onClick={() => setRule({ monthly_type: 'exact-day' })}>Calendar day</button><button type="button" className={rule.monthly_type === 'relative-weekday' ? 'active' : ''} aria-pressed={rule.monthly_type === 'relative-weekday'} onClick={() => setRule({ monthly_type: 'relative-weekday' })}>Relative weekday</button><button type="button" className={rule.monthly_type === 'last-day' ? 'active' : ''} aria-pressed={rule.monthly_type === 'last-day'} onClick={() => setRule({ monthly_type: 'last-day' })}>Last day</button></div>
          {rule.monthly_type === 'exact-day' && <div className="input-group compact"><label htmlFor="pm-month-day">Day of month</label><input id="pm-month-day" className="input-field" type="number" min="1" max="31" value={rule.month_day} onChange={event => setRule({ month_day: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })} /></div>}
          {rule.monthly_type === 'relative-weekday' && <div className="pm-form-grid two"><div className="input-group"><label htmlFor="pm-ordinal">Occurrence</label><select id="pm-ordinal" className="input-field" value={rule.ordinal} onChange={event => setRule({ ordinal: event.target.value })}>{ORDINALS.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></div><div className="input-group"><label htmlFor="pm-ordinal-day">Weekday</label><select id="pm-ordinal-day" className="input-field" value={rule.ordinal_day} onChange={event => setRule({ ordinal_day: event.target.value })}>{WEEKDAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>}
        </div>
      )}
      <div className="pm-form-grid two">
        <div className="input-group"><label htmlFor="pm-start-date">Starts</label><input id="pm-start-date" className="input-field" type="date" value={rule.start_date} onChange={event => setRule({ start_date: event.target.value })} /></div>
        <div className="input-group"><label htmlFor="pm-timezone">Timezone</label><select id="pm-timezone" className="input-field" value={rule.timezone} onChange={event => setRule({ timezone: event.target.value })}>{[...new Set([rule.timezone, browserTimezone(), ...TIMEZONES])].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></div>
        <div className="input-group"><label htmlFor="pm-weekend-policy">Weekend policy</label><select id="pm-weekend-policy" className="input-field" value={rule.non_working_day_rule} onChange={event => setRule({ non_working_day_rule: event.target.value })}><option value="none">Keep scheduled date</option><option value="roll-previous-friday">Move to previous Friday</option><option value="roll-next-monday">Move to next Monday</option></select></div>
        <div className="input-group"><label htmlFor="pm-due-days">Due after issue</label><div className="pm-input-suffix"><input id="pm-due-days" className="input-field" type="number" min="0" max="365" value={rule.due_after_issued_days} onChange={event => setRule({ due_after_issued_days: Math.max(0, Number(event.target.value) || 0) })} /><span>days</span></div></div>
      </div>
      <div className="pm-form-grid two">
        <div className="input-group"><label htmlFor="pm-end-rule">Schedule ends</label><select id="pm-end-rule" className="input-field" value={rule.end_rule} onChange={event => setRule({ end_rule: event.target.value })}><option value="never">Never</option><option value="after-count">After a number of issues</option><option value="on-date">On a date</option></select></div>
        {rule.end_rule === 'after-count' && <div className="input-group"><label htmlFor="pm-end-count">Issue count</label><input id="pm-end-count" className="input-field" type="number" min="1" value={rule.end_count || 12} onChange={event => setRule({ end_count: Math.max(1, Number(event.target.value) || 1) })} /></div>}
        {rule.end_rule === 'on-date' && <div className="input-group"><label htmlFor="pm-end-date">End date</label><input id="pm-end-date" className="input-field" type="date" min={rule.start_date} value={rule.end_date || rule.start_date} onChange={event => setRule({ end_date: event.target.value })} /></div>}
      </div>
      <div ref={summaryRef} id="pm-rule-summary" className={`pm-rule-summary ${previewError ? 'error' : ''}`} role={previewError ? 'alert' : 'status'} tabIndex={-1}>{previewing ? <><RefreshCw className="pm-spin" size={15} /> Calculating schedule...</> : previewError ? <><AlertTriangle size={15} /> {previewError}</> : <><CheckCircle2 size={15} /> {preview?.summary || 'Complete the rule to preview upcoming work.'}</>}</div>
    </section>
  );
}

function TemplateEditor({ form, setForm, onOpenTaskSelect, onUnlinkTask, titleInputRef }) {
  const [taskName, setTaskName] = useState('');
  const [taskType, setTaskType] = useState('checkbox');
  const [unit, setUnit] = useState('');
  const addTask = () => {
    if (!taskName.trim()) return;
    const item = { id: crypto.randomUUID(), task: taskName.trim(), type: taskType, required: true };
    if (taskType === 'reading' && unit.trim()) item.unit = unit.trim();
    setForm(current => ({ ...current, checklistItems: [...current.checklistItems, item] }));
    setTaskName('');
    setUnit('');
  };
  return (
    <section className="pm-panel">
      <div className="pm-section-title"><ListChecks size={17} /><div><span>Work order template</span><small>Snapshot instructions into every generated work order.</small></div></div>
      <div className="input-group">
        <span className="pm-field-label">Linked task template</span>
        <TaskTemplateLinkSelector
          linkedTask={form.taskId ? {
            id: form.taskId,
            code: form.taskCode,
            description: form.taskDescription,
          } : null}
          checklistCount={form.checklistItems.length}
          onOpen={onOpenTaskSelect}
          onUnlink={onUnlinkTask}
          emptyText="Link an existing task template to populate this PM plan's instructions and checklist"
        />
      </div>
      <div className="pm-form-grid two"><div className="input-group"><label htmlFor="pm-plan-title">Plan title <span className="pm-required">Required</span></label><input ref={titleInputRef} id="pm-plan-title" className="input-field" required value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Quarterly air handler inspection" /></div><div className="input-group"><label htmlFor="pm-plan-category">Task category</label><input id="pm-plan-category" className="input-field" value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} /></div><div className="input-group"><label htmlFor="pm-plan-trade">Trade</label><input id="pm-plan-trade" className="input-field" value={form.trade} onChange={event => setForm(current => ({ ...current, trade: event.target.value }))} placeholder="Assigned trade" /></div><div className="input-group"><label htmlFor="pm-plan-priority">Priority</label><select id="pm-plan-priority" className="input-field" value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div><div className="input-group"><label htmlFor="pm-plan-hours">Estimated labor</label><div className="pm-input-suffix"><input id="pm-plan-hours" className="input-field" type="number" min="0.25" step="0.25" value={form.estimatedHours} onChange={event => setForm(current => ({ ...current, estimatedHours: event.target.value }))} /><span>hours</span></div></div></div>
      <div className="input-group"><label htmlFor="pm-plan-description">Standard work instructions</label><textarea id="pm-plan-description" className="input-field" rows="3" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="Describe the inspection, service procedure, parts, and expected result." /></div>
      <div className="pm-checklist">
        <div className="pm-checklist-head"><strong>Checklist</strong><span>{form.checklistItems.length} steps</span></div>
        {form.checklistItems.map((item, index) => <div className="pm-task" key={item.id || index}><span className="pm-task-index">{index + 1}</span><div><strong>{item.task}</strong><small>{item.type === 'reading' ? `Reading${item.unit ? ` · ${item.unit}` : ''}` : item.type === 'pass-fail' ? 'Pass / fail' : 'Checkbox'}</small></div><button type="button" className="pm-task-remove" title="Remove checklist item" aria-label={`Remove checklist item ${index + 1}: ${item.task}`} onClick={() => setForm(current => ({ ...current, checklistItems: current.checklistItems.filter((_, itemIndex) => itemIndex !== index) }))}><X size={14} /></button></div>)}
        <div className="pm-add-task"><label className="sr-only" htmlFor="pm-checklist-task">Checklist step</label><input id="pm-checklist-task" className="input-field" value={taskName} onChange={event => setTaskName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTask(); } }} placeholder="Add an inspection or service step" /><label className="sr-only" htmlFor="pm-checklist-type">Checklist response type</label><select id="pm-checklist-type" className="input-field" value={taskType} onChange={event => setTaskType(event.target.value)}><option value="checkbox">Checkbox</option><option value="pass-fail">Pass / fail</option><option value="reading">Reading</option></select>{taskType === 'reading' && <><label className="sr-only" htmlFor="pm-checklist-unit">Reading unit</label><input id="pm-checklist-unit" className="input-field" value={unit} onChange={event => setUnit(event.target.value)} placeholder="Unit" /></>}<button type="button" className="btn btn-secondary btn-sm" onClick={addTask} disabled={!taskName.trim()}><Plus size={14} /> Add</button></div>
      </div>
    </section>
  );
}

function Forecast({ preview, previewError, previewing, estimatedHours, startDateString, rule }) {
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'calendar'
  const occurrences = useMemo(() => preview?.occurrences || [], [preview?.occurrences]);
  const hours = Number(estimatedHours) || 0;

  const scheduleStartDate = useMemo(() => {
    if (!startDateString) return new Date();
    const parsed = new Date(startDateString + 'T00:00:00');
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [startDateString]);

  const [navYearMonth, setNavYearMonth] = useState(null);

  const calendarViewDate = useMemo(() => {
    if (navYearMonth) return navYearMonth;
    return {
      year: scheduleStartDate.getFullYear(),
      month: scheduleStartDate.getMonth(),
    };
  }, [navYearMonth, scheduleStartDate]);

  const displayMonthDate = useMemo(() => {
    return new Date(calendarViewDate.year, calendarViewDate.month, 1);
  }, [calendarViewDate.year, calendarViewDate.month]);

  const monthName = displayMonthDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(calendarViewDate.year, calendarViewDate.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(calendarViewDate.year, calendarViewDate.month, 1).getDay();

  const isLimited = rule?.end_rule === 'after-count' || rule?.end_rule === 'on-date';

  // Occurrence metrics: whole year (for ongoing schedules) or total lifetime occurrences (when limited)
  const displayCount = useMemo(() => {
    if (rule?.end_rule === 'after-count') {
      return Math.max(1, Number(rule.end_count) || (occurrences.length || 1));
    }
    if (rule?.end_rule === 'on-date') {
      return occurrences.length;
    }

    const start = new Date(scheduleStartDate);
    const oneYearLater = new Date(start);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    const inYear = occurrences.filter(o => {
      const issue = new Date(o.issue_datetime);
      const nominal = o.nominal_scheduled_date ? new Date(o.nominal_scheduled_date + 'T00:00:00') : issue;
      return (issue >= start && issue <= oneYearLater) || (nominal >= start && nominal <= oneYearLater);
    });

    return inYear.length || occurrences.length;
  }, [occurrences, scheduleStartDate, rule?.end_rule, rule?.end_count]);

  const totalLaborHours = (displayCount * hours).toFixed(1);

  // Month counts
  const monthIssuesCount = useMemo(() => {
    return occurrences.filter(o => {
      const issue = new Date(o.issue_datetime);
      return issue.getFullYear() === calendarViewDate.year && issue.getMonth() === calendarViewDate.month;
    }).length;
  }, [occurrences, calendarViewDate]);

  const monthDuesCount = useMemo(() => {
    return occurrences.filter(o => {
      const due = new Date(o.due_datetime);
      return due.getFullYear() === calendarViewDate.year && due.getMonth() === calendarViewDate.month;
    }).length;
  }, [occurrences, calendarViewDate]);

  const handlePrevMonth = () => {
    const prevDate = new Date(calendarViewDate.year, calendarViewDate.month - 1, 1);
    setNavYearMonth({ year: prevDate.getFullYear(), month: prevDate.getMonth() });
  };

  const handleNextMonth = () => {
    const nextDate = new Date(calendarViewDate.year, calendarViewDate.month + 1, 1);
    setNavYearMonth({ year: nextDate.getFullYear(), month: nextDate.getMonth() });
  };

  const handleResetToStartMonth = () => {
    setNavYearMonth(null);
  };

  const isDifferentFromStartMonth =
    calendarViewDate.year !== scheduleStartDate.getFullYear() ||
    calendarViewDate.month !== scheduleStartDate.getMonth();

  return (
    <aside className="pm-forecast">
      <div className="pm-forecast-hero">
        <div className="pm-forecast-hero-header">
          <div>
            <span className="pm-eyebrow">Live recurrence forecast</span>
            <h3>Engine projection</h3>
          </div>
          <div className="pm-forecast-toggle" role="group" aria-label="Forecast view mode">
            <button
              type="button"
              className={viewMode === 'timeline' ? 'active' : ''}
              onClick={() => setViewMode('timeline')}
              aria-pressed={viewMode === 'timeline'}
            >
              List schedule
            </button>
            <button
              type="button"
              className={viewMode === 'calendar' ? 'active' : ''}
              onClick={() => {
                setViewMode('calendar');
                setNavYearMonth(null);
              }}
              aria-pressed={viewMode === 'calendar'}
            >
              Month view
            </button>
          </div>
        </div>
        <p>{preview?.summary || 'Upcoming issue and due dates will appear here.'}</p>
      </div>

      <div className="pm-metrics">
        <div>
          <Gauge size={17} />
          <strong>{displayCount}</strong>
          <span>{isLimited ? 'total occurrences' : 'runs / year'}</span>
        </div>
        <div>
          <Clock3 size={17} />
          <strong>{totalLaborHours}</strong>
          <span>{isLimited ? 'total labor hrs' : 'labor hrs / yr'}</span>
        </div>
      </div>

      {previewing ? (
        <div className="pm-forecast-empty" role="status"><RefreshCw className="pm-spin" size={24} /><strong>Updating forecast</strong><span>Calculating upcoming issue and due dates.</span></div>
      ) : previewError ? (
        <div className="pm-forecast-empty pm-forecast-error" role="alert"><AlertTriangle size={26} /><strong>Forecast unavailable</strong><span>{previewError}</span></div>
      ) : viewMode === 'timeline' ? (
        <div className="pm-timeline">
          {occurrences.length === 0 ? (
            <div className="pm-forecast-empty">
              <CalendarDays size={30} />
              <span>No structured forecast available</span>
            </div>
          ) : (
            occurrences.slice(0, 12).map((item, index) => (
              <div className="pm-occurrence" key={`${item.nominal_scheduled_datetime}-${index}`}>
                <span className="pm-occurrence-dot">{index + 1}</span>
                <div>
                  <strong>{formatDateTime(item.issue_datetime)}</strong>
                  <span>Due {formatDateTime(item.due_datetime)}</span>
                  {item.adjustment_reason && (
                    <small><AlertTriangle size={11} /> {item.adjustment_reason}</small>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Month View Calendar */
        <div className="pm-calendar-view">
          {/* Month Navigation */}
          <div className="pm-calendar-nav">
            <div className="pm-calendar-nav-buttons">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="btn btn-ghost btn-icon-xs"
                title="Previous month"
                aria-label="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="btn btn-ghost btn-icon-xs"
                title="Next month"
                aria-label="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="pm-calendar-title">
              <strong>{monthName}</strong>
              {isDifferentFromStartMonth && (
                <button
                  type="button"
                  onClick={handleResetToStartMonth}
                  className="pm-start-month-btn"
                  title="Jump back to schedule start month"
                >
                  <RotateCcw size={11} /> Start month
                </button>
              )}
            </div>

            <div className="pm-calendar-counts">
              <span className="text-primary font-bold">{monthIssuesCount} issued</span> • <span className="text-success font-bold">{monthDuesCount} due</span>
            </div>
          </div>

          {/* Weekday Column Headers */}
          <div className="pm-calendar-grid-header" role="row">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          {/* Calendar Day Matrix */}
          <div className="pm-calendar-grid" role="grid" aria-label={`${monthName} maintenance schedule`}>
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="pm-calendar-cell empty" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNumber = i + 1;

              const issuedOnDay = occurrences.filter(o => {
                const d = new Date(o.issue_datetime);
                return d.getFullYear() === calendarViewDate.year &&
                  d.getMonth() === calendarViewDate.month &&
                  d.getDate() === dayNumber;
              });

              const dueOnDay = occurrences.filter(o => {
                const d = new Date(o.due_datetime);
                return d.getFullYear() === calendarViewDate.year &&
                  d.getMonth() === calendarViewDate.month &&
                  d.getDate() === dayNumber;
              });

              const isIssued = issuedOnDay.length > 0;
              const isDue = dueOnDay.length > 0;
              const isBoth = isIssued && isDue;

              let cellClass = 'pm-calendar-cell';
              if (isBoth) cellClass += ' has-both';
              else if (isIssued) cellClass += ' has-issue';
              else if (isDue) cellClass += ' has-due';

              return (
                <div
                  key={`day-${dayNumber}`}
                  className={cellClass}
                  role="gridcell"
                  aria-label={
                    isBoth
                      ? `Day ${dayNumber}: Work Order Issued & Due on this day`
                      : isIssued
                      ? `Day ${dayNumber}: Work Order Issued (${issuedOnDay.map(o => `#${o.occurrence_number}`).join(', ')})`
                      : isDue
                      ? `Day ${dayNumber}: Work Order Due (${dueOnDay.map(o => `#${o.occurrence_number}`).join(', ')})`
                      : `Day ${dayNumber}`
                  }
                >
                  <span className="pm-day-num">{dayNumber}</span>
                  <div className="pm-cell-badges">
                    {isBoth ? (
                      <span className="pm-badge-both"><CircleDot size={10} aria-hidden="true" /> Issue & due</span>
                    ) : isIssued ? (
                      <span className="pm-badge-issue">
                        <CircleDot size={10} aria-hidden="true" /> Issue{issuedOnDay.length > 1 ? ` (${issuedOnDay.length})` : ''}
                      </span>
                    ) : isDue ? (
                      <span className="pm-badge-due">
                        <Check size={10} aria-hidden="true" /> Due{dueOnDay.length > 1 ? ` (${dueOnDay.length})` : ''}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="pm-calendar-legend">
            <div>
              <span className="pm-legend-dot issue" /> Issue date
            </div>
            <div>
              <span className="pm-legend-dot due" /> Due date
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function PMSchedulerStudio({ isOpen, onClose, currentUser, onWorkOrderGenerated, initialSearch = '', initialTask = null, initialItem = null, initialItemType = null }) {
  const [view, setView] = useState('registry');
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [schedulerLoadError, setSchedulerLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState(null);
  const [sites, setSites] = useState([]);
  const [floorplans, setFloorplans] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);
  const closeButtonRef = useRef(null);
  const registrySearchRef = useRef(null);
  const titleInputRef = useRef(null);
  const recurrenceSummaryRef = useRef(null);
  const closeHandlerRef = useRef(onClose);
  const taskSelectOpenRef = useRef(isTaskSelectOpen);
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor' || Boolean(currentUser?.can_create_pm);

  useEffect(() => {
    closeHandlerRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    taskSelectOpenRef.current = isTaskSelectOpen;
  }, [isTaskSelectOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !taskSelectOpenRef.current) closeHandlerRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => {
      if (view === 'editor') titleInputRef.current?.focus();
      else registrySearchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen, view]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadTimer = window.setTimeout(async () => {
      setLoading(true);
      setSchedulerLoadError('');
      try {
        const [schRes, siteRes, userRes] = await Promise.all([
          getPMSchedules(),
          getSites(),
          getAssignableUsers(),
        ]);
        if (!active) return;
        setSchedules(schRes.data || []);
        setSites(siteRes.data || []);
        setUsers(userRes.data || []);
      } catch (err) {
        if (active) setSchedulerLoadError(getErrorMessage(err, 'Unable to load scheduler data.'));
      } finally {
        if (active) setLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || view !== 'editor') return;
    let active = true;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        let previewCount = 400;
        if (form.recurrence?.end_rule === 'after-count') {
          previewCount = Math.min(1000, Math.max(1, Number(form.recurrence.end_count) || 12));
        } else if (form.recurrence?.end_rule === 'on-date' && form.recurrence?.start_date && form.recurrence?.end_date) {
          const start = new Date(form.recurrence.start_date);
          const end = new Date(form.recurrence.end_date);
          const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 5;
          previewCount = Math.min(1000, Math.max(400, diffDays));
        }
        const result = await previewPMSchedule({
          recurrence_version: 1,
          recurrence_rule: form.recurrence,
          count: previewCount,
        });
        if (!active) return;
        setPreview(result.data);
        setPreviewError('');
      } catch (error) {
        if (!active) return;
        setPreview(null);
        setPreviewError(getErrorMessage(error, 'This recurrence rule is not valid.'));
      } finally {
        if (active) setPreviewing(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, view, form.recurrence]);

  useEffect(() => {
    if (!isOpen || view !== 'editor') return;
    let active = true;
    if (form.siteId) {
      getFloorplans(form.siteId)
        .then(result => { if (active) setFloorplans(result.data || []); })
        .catch(() => { if (active) setFloorplans([]); });
    }
    return () => { active = false; };
  }, [isOpen, view, form.siteId]);

  useEffect(() => {
    if (!isOpen || view !== 'editor') return;
    let active = true;
    if (form.floorplanId) {
      Promise.all([getEquipment(form.floorplanId), getRooms(form.floorplanId)])
        .then(([equipmentResult, roomResult]) => {
          if (!active) return;
          setEquipment(equipmentResult.data || []);
          setRooms(roomResult.data || []);
        })
        .catch(() => {
          if (!active) return;
          setEquipment([]);
          setRooms([]);
        });
    } else {
      Promise.all([getAllEquipment(), getAllRooms()])
        .then(([equipmentResult, roomResult]) => {
          if (!active) return;
          const siteId = Number(form.siteId);
          setEquipment((equipmentResult.data || []).filter(item => !siteId || item.site_id === siteId));
          setRooms((roomResult.data || []).filter(item => !siteId || item.site_id === siteId));
        })
        .catch(() => {
          if (!active) return;
          setEquipment([]);
          setRooms([]);
        });
    }
    return () => { active = false; };
  }, [isOpen, view, form.siteId, form.floorplanId]);

  const loadSchedules = async () => {
    setLoading(true);
    setSchedulerLoadError('');
    try { setSchedules((await getPMSchedules()).data || []); }
    catch (error) { setSchedulerLoadError(getErrorMessage(error, 'Unable to load PM schedules.')); }
    finally { setLoading(false); }
  };

  if (!isOpen) return null;

  const openCreate = () => { setForm(applyTaskDefaults(emptyForm(), initialTask, initialItem, initialItemType)); setPreview(null); setFloorplans([]); setView('editor'); };
  const openEdit = schedule => { setForm(scheduleToForm(schedule)); setPreview(null); setView('editor'); };
  const toggleId = (field, id) => setForm(current => ({ ...current, [field]: current[field].includes(id) ? current[field].filter(value => value !== id) : [...current[field], id] }));
  const selectTask = task => {
    setFloorplans([]);
    setForm(current => applyTaskDefaults(current, task, initialItem, initialItemType));
  };
  const notify = (type, text) => { setMessage({ type, text }); window.setTimeout(() => setMessage(null), 4500); };

  const saveSchedule = async event => {
    event.preventDefault();
    if (!form.title.trim()) {
      notify('error', 'Enter a plan title.');
      titleInputRef.current?.focus();
      return;
    }
    if (previewError || !preview) {
      notify('error', 'Resolve the recurrence rule before saving.');
      recurrenceSummaryRef.current?.focus();
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(), description: form.description.trim() || null, category: form.category.trim() || 'Preventive Maintenance',
      trade: form.trade.trim() || null, task_id: form.taskId,
      priority: form.priority, cron_expression: '0 0 1 * *',
      recurrence_version: 1, recurrence_rule: form.recurrence,
      timezone: form.recurrence.timezone,
      checklist_items: form.checklistItems, is_active: form.isActive,
      site_id: form.siteId ? Number(form.siteId) : null, floorplan_id: form.floorplanId ? Number(form.floorplanId) : null,
      equipment_ids: form.equipmentIds, room_ids: form.roomIds, assigned_user_ids: form.assigneeIds,
      estimated_hours: Number(form.estimatedHours) || 1,
    };
    try {
      if (form.id) await updatePMSchedule(form.id, payload); else await createPMSchedule(payload);
      await loadSchedules();
      setView('registry');
      notify('success', form.id ? 'Maintenance plan updated.' : 'Maintenance plan saved and activated.');
    } catch (error) { notify('error', getErrorMessage(error, 'Unable to save the maintenance plan.')); }
    finally { setSaving(false); }
  };

  const toggleActive = async schedule => {
    try { await updatePMSchedule(schedule.id, { is_active: !schedule.is_active }); await loadSchedules(); }
    catch (error) { notify('error', getErrorMessage(error, 'Unable to change schedule status.')); }
  };
  const runNow = async schedule => {
    try { const result = await triggerPMSchedule(schedule.id); notify('success', `Generated ${result.data.order_number} without changing the planned cadence.`); onWorkOrderGenerated?.(result.data); }
    catch (error) { notify('error', getErrorMessage(error, 'Unable to generate a work order.')); }
  };
  const remove = async schedule => {
    if (!window.confirm(`Delete "${schedule.title}"? Existing work orders will be retained.`)) return;
    try { await deletePMSchedule(schedule.id); await loadSchedules(); notify('success', 'Maintenance plan deleted.'); }
    catch (error) { notify('error', getErrorMessage(error, 'Unable to delete the maintenance plan.')); }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay modal-backdrop modal-backdrop-dark pm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card modal-2xl glass-panel pm-studio" role="dialog" aria-modal="true" aria-labelledby="pm-studio-title" aria-describedby="pm-studio-subtitle" onClick={event => event.stopPropagation()}>
        <header className="modal-card-header pm-studio-header">
          <div className="pm-brand">
            <div className="pm-brand-mark" aria-hidden="true"><CalendarDays size={20} /></div>
            <div className="pm-brand-copy">
              <span className="pm-eyebrow">Maintenance control</span>
              <h2 id="pm-studio-title">PM Schedule Builder</h2>
              <p id="pm-studio-subtitle">{view === 'registry' ? 'Manage recurring preventive maintenance plans.' : form.id ? 'Review and update this maintenance plan.' : 'Build a recurring preventive maintenance plan.'}</p>
            </div>
          </div>
          <div className="pm-header-actions">
            {view === 'editor' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('registry')}><ChevronLeft size={15} /> Back to registry</button>}
            <button ref={closeButtonRef} type="button" className="btn btn-ghost btn-icon-sm pm-close-button" onClick={onClose} aria-label="Close PM scheduler" title="Close PM scheduler"><X size={19} /></button>
          </div>
        </header>
        {message && <div className={`pm-toast ${message.type}`} role="status">{message.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<span>{message.text}</span></div>}
        <main className="pm-studio-body">
          {view === 'registry' ? <ScheduleRegistry
            key={initialSearch || 'registry'}
            schedules={schedules}
            sites={sites}
            loading={loading}
            error={schedulerLoadError}
            canEdit={canEdit}
            initialSearch={initialSearch}
            onCreate={openCreate}
            onEdit={openEdit}
            onToggle={toggleActive}
            onRun={runNow}
            onDelete={remove}
            onRetry={loadSchedules}
            searchInputRef={registrySearchRef}
          /> : (
            <form className="pm-builder" onSubmit={saveSchedule}>
              <div className="pm-builder-main">
                <div className="pm-editor-heading"><div><span className="pm-eyebrow">{form.id ? 'Edit maintenance plan' : 'New maintenance plan'}</span><h3>{form.title || 'Untitled PM plan'}</h3></div><span className={`pm-status ${form.isActive ? 'active' : ''}`}>{form.isActive ? 'Will activate' : 'Will remain paused'}</span></div>
                <TemplateEditor
                  form={form}
                  setForm={setForm}
                  onOpenTaskSelect={() => setIsTaskSelectOpen(true)}
                  onUnlinkTask={() => selectTask(null)}
                  titleInputRef={titleInputRef}
                />
                <RecurrenceEditor form={form} setForm={setForm} preview={preview} previewError={previewError} previewing={previewing} summaryRef={recurrenceSummaryRef} />
                <AssetsOwnershipSection
                  headingId="pm-assets-heading"
                  description="Connect real EquipMap locations, assets, and technicians."
                  sites={sites}
                  floorplans={floorplans}
                  selectedSiteId={form.siteId}
                  selectedFloorplanId={form.floorplanId}
                  onSiteChange={value => {
                    setFloorplans([]);
                    setForm(current => ({ ...current, siteId: value, floorplanId: '', equipmentIds: [], roomIds: [] }));
                  }}
                  onFloorplanChange={value => setForm(current => ({ ...current, floorplanId: value, equipmentIds: [], roomIds: [] }))}
                  equipment={equipment}
                  selectedEquipmentIds={form.equipmentIds}
                  onToggleEquipment={id => toggleId('equipmentIds', id)}
                  onClearEquipment={() => setForm(current => ({ ...current, equipmentIds: [] }))}
                  equipmentPlaceholder="Search target equipment..."
                  rooms={rooms}
                  selectedRoomIds={form.roomIds}
                  onToggleRoom={id => toggleId('roomIds', id)}
                  onClearRooms={() => setForm(current => ({ ...current, roomIds: [] }))}
                  roomPlaceholder="Search target rooms..."
                  technicians={users}
                  selectedTechnicianIds={form.assigneeIds}
                  onToggleTechnician={id => toggleId('assigneeIds', id)}
                  onClearTechnicians={() => setForm(current => ({ ...current, assigneeIds: [] }))}
                />
                <div className="pm-savebar"><label className="pm-active-toggle"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} /><span><strong>Activate after saving</strong><small>Paused plans can still be run manually.</small></span></label><div><button type="button" className="btn btn-secondary" onClick={() => setView('registry')}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving || previewing}><Save size={15} /> {saving ? 'Saving...' : form.id ? 'Update plan' : 'Save plan'}</button></div></div>
              </div>
              <Forecast preview={preview} previewError={previewError} previewing={previewing} estimatedHours={form.estimatedHours} startDateString={form.recurrence.start_date} rule={form.recurrence} />
            </form>
          )}
        </main>
        {isTaskSelectOpen && (
          <TaskSelectModal
            isOpen={isTaskSelectOpen}
            onClose={() => setIsTaskSelectOpen(false)}
            onSelectTask={selectTask}
            title="Select Task Template to Link"
            subtitle="Link a standard maintenance task template to populate this PM plan's instructions and checklist items."
            actionButtonLabel="Link Template to PM Plan"
            currentLinkedTaskId={form.taskId}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
