import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, CheckCircle2, RefreshCw, Filter, Search,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  User, MapPin, Calendar, Copy, Check, AlertTriangle,
  Wrench, X, Building, Printer, UserPlus, Trash2, List, CalendarDays
} from 'lucide-react';
import WorkOrderDetailModal from './WorkOrderDetailModal';
import WorkOrderTriageModal from './WorkOrderTriageModal';
import PMSchedulerModal from './PMSchedulerModal';
import CloseWorkOrderModal from './CloseWorkOrderModal';
import WorkOrderCard from './WorkOrderCard';
import WorkOrderPrintModal from './WorkOrderPrintModal';
import BulkAssignWorkOrdersModal from './BulkAssignWorkOrdersModal';
import BulkCloseWorkOrdersModal from './BulkCloseWorkOrdersModal';
import BulkDeleteWorkOrdersModal from './BulkDeleteWorkOrdersModal';
import WorkOrderCalendar from './WorkOrderCalendar';
import PMScheduleDetailModal from './PMScheduleDetailModal';
import { isWorkOrderOverdue } from '../utils/workOrderDueDate';
import { getWorkOrderSource, WORK_ORDER_SOURCES } from '../utils/workOrderSource';
import './WorkOrderTable.css';

export default function WorkOrderTable({
  allWorkOrders = [],
  filteredWorkOrders = [],
  isLoading = false,
  error = null,
  loadWorkOrders,
  currentUser,
  statusFilter = 'all',
  setStatusFilter,
  priorityFilter = 'all',
  setPriorityFilter,
  categoryFilter = 'all',
  setCategoryFilter,
  sourceFilter = 'all',
  setSourceFilter,
  tradeFilter = 'all',
  setTradeFilter,
  techFilter = 'all',
  setTechFilter,
  dateFilter = 'all',
  setDateFilter,
  lastUpdatedTime = null,
  searchQuery = '',
  setSearchQuery,
  sortField = 'created_at',
  sortOrder = 'desc',
  toggleSort,
  resetFilters,
  goToMap
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [copiedId, setCopiedId] = useState(null);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState('list');

  // Multi-selection for bulk actions
  const [selectedWoIds, setSelectedWoIds] = useState([]);

  // Modals state
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [triagingWorkOrder, setTriagingWorkOrder] = useState(null);
  const [isPMSchedulerOpen, setIsPMSchedulerOpen] = useState(false);
  const [selectedPMOccurrence, setSelectedPMOccurrence] = useState(null);
  const [closingWorkOrder, setClosingWorkOrder] = useState(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printingWorkOrders, setPrintingWorkOrders] = useState([]);

  // Bulk action modals
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const [isBulkCloseOpen, setIsBulkCloseOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  useEffect(() => {
    const storedScrollKey = `equipmap:work-order-scroll:${location.key}`;
    const scrollStorageKey = location.state?.restoreScrollStorageKey || storedScrollKey;
    let storedScrollY;
    try {
      const savedScrollY = window.sessionStorage.getItem(scrollStorageKey);
      storedScrollY = savedScrollY === null ? undefined : Number(savedScrollY);
    } catch {
      storedScrollY = undefined;
    }

    const scrollY = Number.isFinite(location.state?.restoreScrollY)
      ? location.state.restoreScrollY
      : storedScrollY;
    if (!Number.isFinite(scrollY) || isLoading || allWorkOrders.length === 0) return undefined;

    let outerFrame;
    let restoreFrame;
    outerFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });

        try {
          window.sessionStorage.removeItem(scrollStorageKey);
        } catch {
          // Scroll restoration has already completed without storage cleanup.
        }

        const nextState = { ...(location.state || {}) };
        delete nextState.restoreScrollY;
        delete nextState.restoreScrollStorageKey;
        navigate(location.pathname + location.search, {
          replace: true,
          state: Object.keys(nextState).length > 0 ? nextState : undefined
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(restoreFrame);
    };
  }, [allWorkOrders.length, isLoading, location.key, location.pathname, location.search, location.state, navigate]);

  // Auto-open work order from QR code scan or URL query param
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const targetWoId = searchParams.get('woId') || searchParams.get('workOrderId');
    let openFrame;
    if (targetWoId && allWorkOrders.length > 0 && !selectedWorkOrder) {
      const found = allWorkOrders.find(w => String(w.id) === String(targetWoId) || w.order_number === targetWoId);
      if (found) {
        openFrame = window.requestAnimationFrame(() => setSelectedWorkOrder(found));
      }
    }
    return () => window.cancelAnimationFrame(openFrame);
  }, [searchParams, allWorkOrders, selectedWorkOrder]);

  // Extract unique categories & assignees & trades with counts
  const uniqueCategories = useMemo(() => {
    const counts = {};
    allWorkOrders.forEach(wo => {
      const cat = wo.category || 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [allWorkOrders]);

  const sourceCounts = useMemo(() => {
    const counts = Object.fromEntries(WORK_ORDER_SOURCES.map(source => [source.value, 0]));
    allWorkOrders.forEach(wo => { counts[getWorkOrderSource(wo)] += 1; });
    return counts;
  }, [allWorkOrders]);

  const uniqueTrades = useMemo(() => {
    const counts = {};
    allWorkOrders.forEach(wo => {
      if (wo.trade) {
        counts[wo.trade] = (counts[wo.trade] || 0) + 1;
      }
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allWorkOrders]);

  const uniqueAssignees = useMemo(() => {
    const counts = {};
    const nameMap = {};
    allWorkOrders.forEach(wo => {
      if (Array.isArray(wo.assignees) && wo.assignees.length > 0) {
        wo.assignees.forEach(u => {
          counts[u.username] = (counts[u.username] || 0) + 1;
          if (u.full_name) {
            nameMap[u.username] = u.full_name;
          } else if (!nameMap[u.username]) {
            nameMap[u.username] = u.username;
          }
        });
      } else {
        counts['Unassigned'] = (counts['Unassigned'] || 0) + 1;
        nameMap['Unassigned'] = 'Unassigned';
      }
    });
    const entries = Object.entries(counts).map(([username, count]) => ({
      username,
      name: nameMap[username] || username,
      count
    }));
    return entries.sort((a, b) => {
      if (a.username === 'Unassigned') return -1;
      if (b.username === 'Unassigned') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });
  }, [allWorkOrders]);

  // Overall metric counts
  const totalCount = allWorkOrders.length;
  const openCount = useMemo(() => {
    return allWorkOrders.filter(w =>
      w.status !== 'completed' && w.status !== 'cancelled' && w.status !== 'rejected'
    ).length;
  }, [allWorkOrders]);

  const completedCount = useMemo(() => {
    return allWorkOrders.filter(w => w.status === 'completed').length;
  }, [allWorkOrders]);

  const overdueCount = useMemo(() => {
    const now = new Date();
    return allWorkOrders.filter(workOrder => isWorkOrderOverdue(workOrder, now)).length;
  }, [allWorkOrders]);

  const triageUnassignedCount = useMemo(() => {
    return allWorkOrders.filter(w =>
      w.status === 'pending_triage' ||
      (w.status !== 'completed' && w.status !== 'cancelled' && w.status !== 'rejected' && (!w.assignees || w.assignees.length === 0))
    ).length;
  }, [allWorkOrders]);

  const inProgressCount = useMemo(() => {
    return allWorkOrders.filter(w => w.status === 'in_progress').length;
  }, [allWorkOrders]);

  const assignedCount = useMemo(() => {
    return allWorkOrders.filter(w => w.status === 'assigned').length;
  }, [allWorkOrders]);

  const onHoldCount = useMemo(() => {
    return allWorkOrders.filter(w => w.status === 'on_hold').length;
  }, [allWorkOrders]);

  const cancelledCount = useMemo(() => {
    return allWorkOrders.filter(w => w.status === 'cancelled' || w.status === 'rejected').length;
  }, [allWorkOrders]);

  const unassignedCount = useMemo(() => {
    return allWorkOrders.filter(w => !w.assignees || w.assignees.length === 0).length;
  }, [allWorkOrders]);

  const myWorkOrdersCount = useMemo(() => {
    if (!currentUser?.username) return 0;
    return allWorkOrders.filter(w =>
      (w.assignees || []).some(u => u.username === currentUser.username)
    ).length;
  }, [allWorkOrders, currentUser]);

  const formattedUpdatedTime = useMemo(() => {
    const d = lastUpdatedTime ? new Date(lastUpdatedTime) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  }, [lastUpdatedTime]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredWorkOrders.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedWorkOrders = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    return filteredWorkOrders.slice(start, start + pageSize);
  }, [filteredWorkOrders, validCurrentPage, pageSize]);

  const handleCopyNumber = (woNumber, id, e) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(woNumber);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenWorkOrder = (wo) => {
    if (wo.status === 'pending_triage' && (currentUser?.role === 'admin' || currentUser?.can_triage || currentUser?.is_admin)) {
      setTriagingWorkOrder(wo);
    } else {
      setSelectedWorkOrder(wo);
    }
  };

  // Selection helpers
  const allFilteredSelected = filteredWorkOrders.length > 0 &&
    filteredWorkOrders.every(w => selectedWoIds.includes(w.id));

  const handleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedWoIds([]);
    } else {
      setSelectedWoIds(filteredWorkOrders.map(w => w.id));
    }
  };

  const toggleWoSelection = (id, e) => {
    if (e) e.stopPropagation();
    setSelectedWoIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Print handlers
  const handlePrintSingle = (wo, e) => {
    if (e?.stopPropagation) e.stopPropagation();
    if (wo) {
      setPrintingWorkOrders([wo]);
      setIsPrintModalOpen(true);
    }
  };

  // Selected work order objects
  const selectedWorkOrdersList = useMemo(() => {
    if (selectedWoIds.length === 0) return [];
    const idSet = new Set(selectedWoIds);
    return allWorkOrders.filter(w => idSet.has(w.id));
  }, [allWorkOrders, selectedWoIds]);

  // Bulk action handlers
  const handleBulkActionSuccess = () => {
    setSelectedWoIds([]);
    if (loadWorkOrders) loadWorkOrders(true);
  };

  const handlePrintSelected = () => {
    if (selectedWorkOrdersList.length === 0) return;
    setPrintingWorkOrders(selectedWorkOrdersList);
    setIsPrintModalOpen(true);
  };

  const handlePrintFiltered = () => {
    if (filteredWorkOrders.length === 0) return;
    setPrintingWorkOrders(filteredWorkOrders);
    setIsPrintModalOpen(true);
  };

  // Segmented Quick View Tabs logic
  const isMyOrdersActive = Boolean(currentUser?.username && techFilter === currentUser.username);
  const isTriageActive = Boolean(
    techFilter !== currentUser?.username &&
    (statusFilter === 'triage_unassigned' || statusFilter === 'pending_triage')
  );
  const isOpenActive = Boolean(
    techFilter !== currentUser?.username &&
    statusFilter === 'open'
  );
  const isInProgressActive = Boolean(
    techFilter !== currentUser?.username &&
    statusFilter === 'in_progress'
  );
  const isCompletedActive = Boolean(
    techFilter !== currentUser?.username &&
    dateFilter !== 'overdue' &&
    statusFilter === 'completed'
  );
  const isOverdueActive = dateFilter === 'overdue';
  const isAllActive = Boolean(
    statusFilter === 'all' &&
    techFilter === 'all' &&
    priorityFilter === 'all' &&
    categoryFilter === 'all' &&
    sourceFilter === 'all' &&
    tradeFilter === 'all' &&
    dateFilter === 'all' &&
    !searchQuery
  );

  const handleSelectViewTab = (tabKey) => {
    if (tabKey === 'all') {
      if (setStatusFilter) setStatusFilter('all');
      if (setTechFilter) setTechFilter('all');
      if (setPriorityFilter) setPriorityFilter('all');
      if (setCategoryFilter) setCategoryFilter('all');
      if (setSourceFilter) setSourceFilter('all');
      if (setTradeFilter) setTradeFilter('all');
      if (setDateFilter) setDateFilter('all');
      if (setSearchQuery) setSearchQuery('');
    } else if (tabKey === 'my_orders') {
      if (!currentUser?.username) return;
      if (isMyOrdersActive) {
        if (setTechFilter) setTechFilter('all');
      } else {
        if (setTechFilter) setTechFilter(currentUser.username);
        if (statusFilter === 'completed' || statusFilter === 'cancelled') {
          if (setStatusFilter) setStatusFilter('open');
        }
      }
    } else if (tabKey === 'triage') {
      if (isTriageActive) {
        if (setStatusFilter) setStatusFilter('all');
      } else {
        if (setStatusFilter) setStatusFilter('triage_unassigned');
        if (setTechFilter && techFilter === currentUser?.username) setTechFilter('all');
      }
    } else if (tabKey === 'open') {
      if (isOpenActive) {
        if (setStatusFilter) setStatusFilter('all');
      } else {
        if (setStatusFilter) setStatusFilter('open');
        if (setTechFilter && techFilter === currentUser?.username) setTechFilter('all');
      }
    } else if (tabKey === 'in_progress') {
      if (isInProgressActive) {
        if (setStatusFilter) setStatusFilter('all');
      } else {
        if (setStatusFilter) setStatusFilter('in_progress');
        if (setTechFilter && techFilter === currentUser?.username) setTechFilter('all');
      }
    } else if (tabKey === 'completed') {
      if (isCompletedActive) {
        if (setStatusFilter) setStatusFilter('all');
      } else {
        if (setStatusFilter) setStatusFilter('completed');
        if (setTechFilter && techFilter === currentUser?.username) setTechFilter('all');
      }
    } else if (tabKey === 'overdue') {
      if (isOverdueActive) {
        if (setDateFilter) setDateFilter('all');
      } else {
        if (setDateFilter) setDateFilter('overdue');
        if (setStatusFilter) setStatusFilter('all');
        if (setTechFilter && techFilter === currentUser?.username) setTechFilter('all');
      }
    }
    setCurrentPage(1);
  };

  // Active filters list for dismissible chips
  const activeFilters = useMemo(() => {
    const list = [];
    if (searchQuery && searchQuery.trim()) {
      list.push({
        id: 'search',
        label: `Search: "${searchQuery.trim()}"`,
        onRemove: () => { if (setSearchQuery) setSearchQuery(''); setCurrentPage(1); }
      });
    }
    if (statusFilter !== 'all') {
      let statusLabel = statusFilter;
      if (statusFilter === 'open') statusLabel = 'Open (Active)';
      else if (statusFilter === 'triage_unassigned' || statusFilter === 'pending_triage') statusLabel = 'Needs Triage';
      else if (statusFilter === 'in_progress') statusLabel = 'In Progress';
      else if (statusFilter === 'on_hold') statusLabel = 'On Hold';
      else if (statusFilter === 'completed') statusLabel = 'Completed';
      else if (statusFilter === 'cancelled') statusLabel = 'Cancelled';
      else if (statusFilter === 'assigned') statusLabel = 'Assigned';

      list.push({
        id: 'status',
        label: `Status: ${statusLabel}`,
        onRemove: () => { if (setStatusFilter) setStatusFilter('all'); setCurrentPage(1); }
      });
    }
    if (techFilter !== 'all') {
      const currentDisplayName = currentUser?.full_name || currentUser?.username;
      const foundAssignee = uniqueAssignees.find(u => u.username === techFilter);
      const techLabel = techFilter === currentUser?.username
        ? `${currentDisplayName} (You)`
        : (foundAssignee ? foundAssignee.name : techFilter);
      list.push({
        id: 'tech',
        label: `Tech: ${techLabel}`,
        onRemove: () => { if (setTechFilter) setTechFilter('all'); setCurrentPage(1); }
      });
    }
    if (categoryFilter !== 'all') {
      list.push({
        id: 'category',
        label: `Task: ${categoryFilter}`,
        onRemove: () => { if (setCategoryFilter) setCategoryFilter('all'); setCurrentPage(1); }
      });
    }
    if (sourceFilter !== 'all') {
      const sourceLabel = WORK_ORDER_SOURCES.find(source => source.value === sourceFilter)?.label || sourceFilter;
      list.push({
        id: 'source',
        label: `Source: ${sourceLabel}`,
        onRemove: () => { if (setSourceFilter) setSourceFilter('all'); setCurrentPage(1); }
      });
    }
    if (tradeFilter !== 'all') {
      list.push({
        id: 'trade',
        label: `Trade: ${tradeFilter}`,
        onRemove: () => { if (setTradeFilter) setTradeFilter('all'); setCurrentPage(1); }
      });
    }
    if (priorityFilter !== 'all') {
      list.push({
        id: 'priority',
        label: `Priority: ${priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)}`,
        onRemove: () => { if (setPriorityFilter) setPriorityFilter('all'); setCurrentPage(1); }
      });
    }
    if (dateFilter !== 'all') {
      let dateLabel = dateFilter;
      if (dateFilter === 'today') dateLabel = 'Today';
      else if (dateFilter === 'this_week') dateLabel = 'This Week';
      else if (dateFilter === 'this_month') dateLabel = 'This Month';
      else if (dateFilter === 'past_30') dateLabel = 'Past 30 Days';
      else if (dateFilter === 'overdue') dateLabel = 'Overdue';
      list.push({
        id: 'date',
        label: `Date: ${dateLabel}`,
        onRemove: () => { if (setDateFilter) setDateFilter('all'); setCurrentPage(1); }
      });
    }
    return list;
  }, [searchQuery, statusFilter, techFilter, categoryFilter, sourceFilter, tradeFilter, priorityFilter, dateFilter, currentUser, uniqueAssignees, setSearchQuery, setStatusFilter, setTechFilter, setCategoryFilter, setSourceFilter, setTradeFilter, setPriorityFilter, setDateFilter]);

  const activeFilterCount = activeFilters.length;

  const handleResetAll = () => {
    if (resetFilters) {
      resetFilters();
    } else {
      if (setSearchQuery) setSearchQuery('');
      if (setStatusFilter) setStatusFilter('all');
      if (setTechFilter) setTechFilter('all');
      if (setCategoryFilter) setCategoryFilter('all');
      if (setSourceFilter) setSourceFilter('all');
      if (setTradeFilter) setTradeFilter('all');
      if (setPriorityFilter) setPriorityFilter('all');
      if (setDateFilter) setDateFilter('all');
    }
    setCurrentPage(1);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const canWrite = Boolean(currentUser && currentUser.role !== 'viewer');
  const isAdmin = canWrite && Boolean(currentUser?.role === 'admin' || currentUser?.is_admin);
  const isEditor = canWrite && Boolean(isAdmin || currentUser?.role === 'editor' || currentUser?.can_manage_items);
  const canTriage = canWrite && Boolean(isAdmin || currentUser?.can_triage);
  const canManagePM = canWrite && Boolean(isAdmin || currentUser?.can_create_pm);
  const canAssign = canWrite && Boolean(isAdmin || currentUser?.can_assign || currentUser?.can_triage);
  const canClose = canWrite && Boolean(isAdmin || currentUser?.can_close_work_orders !== false);

  return (
    <div className="list-view-container work-orders-container">
      {/* ========================================================
          1. UNIFIED PAGE HEADER & ACTIONS BAR
          ======================================================== */}
      <div className="wo-header-bar glass-panel">
        {/* Left Title & Summary */}
        <div className="wo-header-left">
          <div className="wo-header-icon-badge">
            <FileText size={20} />
          </div>
          <div>
            <div className="wo-header-title-row">
              <h1 className="wo-header-heading">Work Orders</h1>
              <span className="wo-header-count-badge">
                {filteredWorkOrders.length} {filteredWorkOrders.length === 1 ? 'order' : 'orders'}
              </span>
            </div>
            <div className={`wo-header-subheading ${filteredWorkOrders.length !== totalCount ? 'has-active-filters' : ''}`}>
              <span className="wo-header-results-summary">
                Showing {filteredWorkOrders.length.toLocaleString()} of {totalCount.toLocaleString()} total
              </span>
              <span className="wo-header-last-updated"> • Last updated {formattedUpdatedTime}</span>
            </div>
          </div>
        </div>

        {/* Right Actions Group */}
        <div className={`wo-header-actions ${selectedWoIds.length > 0 ? 'has-selection' : ''}`}>
          {/* Bulk Selection Bar */}
          {selectedWoIds.length > 0 ? (
            <div className="wo-bulk-actions-bar animate-in">
              <span className="wo-bulk-count-badge">{selectedWoIds.length} Selected</span>

              {/* Bulk Assign */}
              {canAssign && (
                <button
                  type="button"
                  className="wo-bulk-btn wo-bulk-btn-assign"
                  onClick={() => setIsBulkAssignOpen(true)}
                  title="Assign technician or dispatch parameters to selected orders"
                >
                  <UserPlus size={13} />
                  <span>Assign</span>
                </button>
              )}

              {/* Bulk Close */}
              {canClose && (
                <button
                  type="button"
                  className="wo-bulk-btn wo-bulk-btn-close"
                  onClick={() => setIsBulkCloseOpen(true)}
                  title="Bulk close selected work orders"
                >
                  <CheckCircle2 size={13} />
                  <span>Close</span>
                </button>
              )}

              {/* Bulk Delete */}
              {(isAdmin || isEditor || canTriage) && (
                <button
                  type="button"
                  className="wo-bulk-btn wo-bulk-btn-delete"
                  onClick={() => setIsBulkDeleteOpen(true)}
                  title="Delete selected work orders"
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>
              )}

              {/* Print Selected */}
              <button
                type="button"
                className="wo-bulk-btn wo-bulk-btn-print"
                onClick={handlePrintSelected}
                title={`Print work order sheets for ${selectedWoIds.length} selected orders`}
              >
                <Printer size={13} />
                <span>Print ({selectedWoIds.length})</span>
              </button>

              {/* Clear Selection */}
              <button
                type="button"
                className="wo-bulk-btn-clear"
                onClick={() => setSelectedWoIds([])}
                title="Clear selection"
              >
                <X size={12} />
                <span>Clear</span>
              </button>
            </div>
          ) : (
            displayMode === 'list' && filteredWorkOrders.length > 0 && (
              <button
                type="button"
                className="wo-action-btn"
                onClick={handlePrintFiltered}
                title={`Print current filtered view (${filteredWorkOrders.length} orders)`}
                aria-label={`Print current filtered view (${filteredWorkOrders.length} orders)`}
              >
                <Printer size={14} />
                <span>Print View ({filteredWorkOrders.length})</span>
              </button>
            )
          )}

          {/* Refresh Button */}
          <button
            type="button"
            className="wo-action-btn"
            onClick={() => loadWorkOrders && loadWorkOrders(true)}
            disabled={isLoading}
            title="Refresh work orders"
            aria-label="Refresh work orders"
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
            <span>Refresh</span>
          </button>

          {/* PM Schedules Button - Only for authorized PM / Triage managers */}
          {canManagePM && (
            <button
              type="button"
              className="btn btn-secondary btn-sm gap-xs"
              onClick={() => setIsPMSchedulerOpen(true)}
              title="Preventive Maintenance Schedules"
              aria-label="Preventive Maintenance Schedules"
            >
              <Calendar size={14} />
              <span>PM Schedules</span>
            </button>
          )}
        </div>
      </div>

      <div className="wo-display-tabs" role="tablist" aria-label="Work order display">
        <button
          type="button"
          id="work-order-list-tab"
          className={displayMode === 'list' ? 'active' : ''}
          onClick={() => setDisplayMode('list')}
          role="tab"
          aria-selected={displayMode === 'list'}
          aria-controls="work-order-list-panel"
        >
          <List size={15} />
          <span>List</span>
        </button>
        <button
          type="button"
          id="work-order-calendar-tab"
          className={displayMode === 'calendar' ? 'active' : ''}
          onClick={() => {
            setDisplayMode('calendar');
            setSelectedWoIds([]);
          }}
          role="tab"
          aria-selected={displayMode === 'calendar'}
          aria-controls="work-order-calendar-panel"
        >
          <CalendarDays size={15} />
          <span>Calendar</span>
        </button>
      </div>

      {/* ========================================================
          2. UNIFIED FILTER CARD (Tabs + Controls + Chips)
          ======================================================== */}
      <div className="wo-filter-card glass-panel">
        <button
          type="button"
          className="wo-mobile-filter-toggle"
          onClick={() => setIsMobileFiltersOpen(open => !open)}
          aria-expanded={isMobileFiltersOpen}
          aria-controls="work-order-filter-panel"
        >
          <span className="wo-mobile-filter-toggle-label">
            <Filter size={16} />
            <span>Filters</span>
          </span>
          <span className="wo-mobile-filter-toggle-actions">
            {activeFilterCount > 0 && (
              <span className="wo-mobile-filter-count">
                {activeFilterCount} active
              </span>
            )}
            {isMobileFiltersOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </span>
        </button>

        <div
          id="work-order-filter-panel"
          className={`wo-filter-content ${isMobileFiltersOpen ? 'is-mobile-filter-open' : ''}`}
        >
        {/* Row A: Segmented Primary View Tabs */}
        <div className="wo-view-tabs-bar" role="tablist" aria-label="Work order views">
          <button
            type="button"
            className={`wo-view-tab ${isAllActive ? 'active' : ''}`}
            onClick={() => handleSelectViewTab('all')}
            title="Show all work orders"
            role="tab"
            aria-selected={isAllActive}
          >
            <span>All Orders</span>
            <span className="wo-tab-badge">{totalCount}</span>
          </button>

          {currentUser?.username && (
            <button
              type="button"
              className={`wo-view-tab my-orders ${isMyOrdersActive ? 'active' : ''}`}
              onClick={() => handleSelectViewTab('my_orders')}
              title="Work orders assigned to you"
              role="tab"
              aria-selected={isMyOrdersActive}
            >
              <User size={13} />
              <span>Assigned to Me</span>
              <span className="wo-tab-badge my-orders">{myWorkOrdersCount}</span>
            </button>
          )}

          {(isAdmin || canTriage) && (
            <button
              type="button"
              className={`wo-view-tab triage ${isTriageActive ? 'active' : ''}`}
              onClick={() => handleSelectViewTab('triage')}
              title="Pending triage and unassigned work orders"
              role="tab"
              aria-selected={isTriageActive}
            >
              <span className="status-dot triage" />
              <span>Needs Triage</span>
              <span className="wo-tab-badge triage">{triageUnassignedCount}</span>
            </button>
          )}

          <button
            type="button"
            className={`wo-view-tab open ${isOpenActive ? 'active' : ''}`}
            onClick={() => handleSelectViewTab('open')}
            title="Active open work orders"
            role="tab"
            aria-selected={isOpenActive}
          >
            <span className="status-dot open" />
            <span>Open</span>
            <span className="wo-tab-badge open">{openCount}</span>
          </button>

          <button
            type="button"
            className={`wo-view-tab in-progress ${isInProgressActive ? 'active' : ''}`}
            onClick={() => handleSelectViewTab('in_progress')}
            title="Work orders currently in progress"
            role="tab"
            aria-selected={isInProgressActive}
          >
            <span className="status-dot in-progress" />
            <span>In Progress</span>
            <span className="wo-tab-badge in-progress">{inProgressCount}</span>
          </button>

          <button
            type="button"
            className={`wo-view-tab completed ${isCompletedActive ? 'active' : ''}`}
            onClick={() => handleSelectViewTab('completed')}
            title="Completed work orders"
            role="tab"
            aria-selected={isCompletedActive}
          >
            <span className="status-dot completed" />
            <span>Completed</span>
            <span className="wo-tab-badge completed">{completedCount}</span>
          </button>

          <button
            type="button"
            className={`wo-view-tab overdue ${isOverdueActive ? 'active' : ''}`}
            onClick={() => handleSelectViewTab('overdue')}
            title="Open work orders past their due date"
            role="tab"
            aria-selected={isOverdueActive}
          >
            <AlertTriangle size={13} />
            <span>Overdue</span>
            <span className="wo-tab-badge overdue">{overdueCount}</span>
          </button>
        </div>

        {/* Row B: Filter Controls */}
        <div className="wo-filter-controls-row filter-toolbar-row">
          {/* 1. Search Box */}
          <div className="wo-search-wrapper filter-search-control flex-auto-search">
            <Search size={15} className="filter-search-icon" />
            <input
              type="text"
              className="input-field filter-control wo-filter-input"
              placeholder="Search request, task, tech, location, #..."
              value={searchQuery || ''}
              onChange={e => { if (setSearchQuery) setSearchQuery(e.target.value); setCurrentPage(1); }}
              aria-label="Search work orders"
            />
            {searchQuery && searchQuery.length > 0 && (
              <button
                type="button"
                className="filter-clear-btn wo-search-clear-btn"
                onClick={() => { if (setSearchQuery) setSearchQuery(''); setCurrentPage(1); }}
                title="Clear search filter"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 2. Status Dropdown */}
          <div className="wo-select-wrapper flex-auto-select">
            <select
              className="input-field filter-control wo-filter-select"
              value={statusFilter}
              onChange={e => { if (setStatusFilter) setStatusFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Status"
            >
              <option value="all">All Statuses ({totalCount})</option>
              <option value="open">Open (Active) ({openCount})</option>
              <option value="triage_unassigned">Needs Triage ({triageUnassignedCount})</option>
              <option value="assigned">Assigned ({assignedCount})</option>
              <option value="in_progress">In Progress ({inProgressCount})</option>
              <option value="on_hold">On Hold ({onHoldCount})</option>
              <option value="completed">Completed ({completedCount})</option>
              <option value="cancelled">Cancelled ({cancelledCount})</option>
            </select>
          </div>

          {/* 3. Technician Dropdown */}
          <div className="wo-select-wrapper flex-auto-select">
            <select
              className="input-field filter-control wo-filter-select"
              value={techFilter}
              onChange={e => { if (setTechFilter) setTechFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Technician"
            >
              <option value="all">All Technicians ({totalCount})</option>
              {currentUser?.username && (
                <option value={currentUser.username}>
                  {(currentUser.full_name || currentUser.username)} (Assigned to Me) ({myWorkOrdersCount})
                </option>
              )}
              <option value="Unassigned">Unassigned ({unassignedCount})</option>
              {uniqueAssignees
                .filter(u => u.username !== 'Unassigned' && u.username !== currentUser?.username)
                .map(u => (
                  <option key={u.username} value={u.username}>
                    {u.name} ({u.count})
                  </option>
                ))}
            </select>
          </div>

          {/* 4. Task Type / Category Dropdown */}
          <div className="wo-select-wrapper flex-auto-select">
            <select
              className="input-field filter-control wo-filter-select"
              value={categoryFilter}
              onChange={e => { if (setCategoryFilter) setCategoryFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Task Type"
            >
              <option value="all">All Task Types ({totalCount})</option>
              {uniqueCategories.map(c => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>

          {/* 5. Preventive Maintenance Source Dropdown */}
          <div className="wo-select-wrapper flex-auto-select">
            <select
              className="input-field filter-control wo-filter-select"
              value={sourceFilter}
              onChange={e => { if (setSourceFilter) setSourceFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by maintenance source"
            >
              <option value="all">All Maintenance Sources ({totalCount})</option>
              {WORK_ORDER_SOURCES.map(source => (
                <option key={source.value} value={source.value}>
                  {source.label} ({sourceCounts[source.value]})
                </option>
              ))}
            </select>
          </div>

          {/* 6. Trade Dropdown */}
          <div className="wo-select-wrapper flex-auto-select">
            <select
              className="input-field filter-control wo-filter-select"
              value={tradeFilter}
              onChange={e => { if (setTradeFilter) setTradeFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Trade"
            >
              <option value="all">All Trades ({totalCount})</option>
              {uniqueTrades.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.count})
                </option>
              ))}
            </select>
          </div>

          {/* 6. Priority Dropdown */}
          <div className="wo-select-wrapper flex-auto-select-sm">
            <select
              className="input-field filter-control wo-filter-select"
              value={priorityFilter}
              onChange={e => { if (setPriorityFilter) setPriorityFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Priority"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* 6. Date Range Dropdown */}
          <div className="wo-select-wrapper flex-auto-select-sm">
            <select
              className="input-field filter-control wo-filter-select"
              value={dateFilter}
              onChange={e => { if (setDateFilter) setDateFilter(e.target.value); setCurrentPage(1); }}
              aria-label="Filter by Date"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="past_30">Past 30 Days</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>

          {/* Reset Button */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm wo-reset-filters-btn"
              onClick={handleResetAll}
              title="Clear all active filters"
            >
              <X size={13} />
              <span>Clear filters</span>
            </button>
          )}
        </div>

        {/* Row C: Active Filter Chips */}
        {activeFilterCount > 0 && (
          <div className="wo-active-chips-row">
            <div className="wo-chips-list">
              <span className="wo-chips-label">Active Filters:</span>
              {activeFilters.map(filter => (
                <span key={filter.id} className="wo-filter-chip">
                  <span>{filter.label}</span>
                  <button
                    type="button"
                    className="wo-chip-remove"
                    onClick={filter.onRemove}
                    title="Remove filter"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="wo-clear-all-text-btn"
                onClick={handleResetAll}
              >
                Clear all
              </button>
            </div>
            <div className="wo-chips-count">
              Showing <strong>{filteredWorkOrders.length}</strong> of <strong>{totalCount}</strong>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="glass-panel alert-box-danger-left p-md mb-lg flex-between">
          <div className="items-center gap-md">
            <AlertTriangle size={20} color="var(--danger-color)" />
            <div>
              <div className="font-semibold text-danger">Error Loading Work Orders</div>
              <div className="text-sm text-muted">{error}</div>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => loadWorkOrders && loadWorkOrders(true)}>
            Retry
          </button>
        </div>
      )}

      {displayMode === 'list' ? (
      <div id="work-order-list-panel" role="tabpanel" aria-labelledby="work-order-list-tab">
      {/* ========================================================
          3. MAIN WORK ORDERS TABLE (8 Columns: CHECKBOX, REQUEST, DATE, TASK, LOCATION, STATUS, TECH, NUMBER)
          ======================================================== */}
      <div className="wo-desktop-view">
        <div className="list-table-wrapper wo-table-wrapper">
          <table className="list-table wo-clean-table">
            <colgroup>
              <col className="wo-col-selection" />
              <col className="wo-col-request" />
              <col className="wo-col-date" />
              <col className="wo-col-category" />
              <col className="wo-col-task" />
              <col className="wo-col-location" />
              <col className="wo-col-status" />
              <col className="wo-col-technician" />
              <col className="wo-col-number" />
            </colgroup>
            <thead>
              <tr>
                {/* 0. CHECKBOX */}
                <th className="th-checkbox wo-selection-column">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={handleSelectAll}
                    disabled={isLoading || filteredWorkOrders.length === 0}
                    aria-label="Select all work orders"
                  />
                </th>

                {/* 1. REQUEST */}
                <th
                  onClick={() => toggleSort && toggleSort('title')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>REQUEST</span>
                    {sortField === 'title' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                {/* 2. DATE */}
                <th
                  onClick={() => toggleSort && toggleSort('created_at')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>DATE</span>
                    {(sortField === 'created_at' || sortField === 'date') && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                {/* 3. CATEGORY */}
                <th
                  onClick={() => toggleSort && toggleSort('category')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>CATEGORY</span>
                    {sortField === 'category' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                <th>TASK TYPE</th>

                {/* 6. LOCATION */}
                <th
                  onClick={() => toggleSort && toggleSort('site_name')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>LOCATION</span>
                    {sortField === 'site_name' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                {/* 5. STATUS */}
                <th
                  onClick={() => toggleSort && toggleSort('status')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>STATUS</span>
                    {sortField === 'status' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                {/* 6. TECH */}
                <th
                  onClick={() => toggleSort && toggleSort('tech')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-xs">
                    <span>TECH</span>
                    {sortField === 'tech' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>

                {/* 7. NUMBER & ACTIONS */}
                <th
                  onClick={() => toggleSort && toggleSort('order_number')}
                  className="sortable-header pointer select-none wo-number-column"
                >
                  <div className="items-center justify-end gap-xs">
                    <span>NUMBER</span>
                    {sortField === 'order_number' && (
                      sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                    )}
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {isLoading && allWorkOrders.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="list-empty p-2xl">
                      <RefreshCw size={36} className="spinning" color="var(--primary-color)" />
                      <p className="mt-md font-semibold text-primary">Loading work orders...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredWorkOrders.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="list-empty">
                      <Filter size={44} className="list-empty-icon" />
                      <p>No work orders match the selected filters</p>
                      {activeFilterCount > 0 && (
                        <button
                          className="btn btn-secondary mt-md text-sm"
                          onClick={() => { if (resetFilters) resetFilters(); setCurrentPage(1); }}
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedWorkOrders.map(wo => {
                  const isCompleted = wo.status === 'completed';
                  const isCancelled = wo.status === 'cancelled' || wo.status === 'rejected';
                  const isPendingTriage = wo.status === 'pending_triage';
                  const isOnHold = wo.status === 'on_hold';
                  const isSelected = selectedWoIds.includes(wo.id);

                  // Location presentation
                  const locTitle = wo.floorplan_name
                    ? `${wo.site_name || 'Site'} - ${wo.floorplan_name}`
                    : (wo.site_name || 'Campus');
                  const linkedLocations = [
                    ...(wo.rooms || []).map(room => ({
                      id: `room-${room.id}`,
                      type: 'room',
                      label: `Room ${room.name || room.id || 'Unnamed'}`,
                      target: { ...room, floorplan_id: room.floorplan_id || wo.floorplan_id }
                    })),
                    ...(wo.equipment || []).map(equipment => ({
                      id: `equipment-${equipment.id}`,
                      type: 'equipment',
                      label: equipment.name || equipment.description || `Equipment ${equipment.id || 'Unnamed'}`,
                      target: { ...equipment, floorplan_id: equipment.floorplan_id || wo.floorplan_id }
                    }))
                  ];
                  const primaryLocation = linkedLocations[0];
                  const additionalLocationCount = Math.max(0, linkedLocations.length - 1);
                  const subLocation = primaryLocation?.label || wo.location_details || 'General Building Area';

                  // Tech name presentation
                  const techNames = wo.assignees?.length > 0
                    ? wo.assignees.map(u => u.full_name || u.username).join(', ')
                    : 'Unassigned';

                  const techTrade = wo.assignees?.[0]?.trade;
                  const techRole = techTrade
                    ? techTrade
                    : (wo.assignees?.[0]?.role
                        ? wo.assignees[0].role.toUpperCase()
                        : (wo.assignees?.length > 0 ? 'TECHNICIAN' : 'AWAITING DISPATCH'));

                  return (
                    <tr
                      key={wo.id}
                      className={`wo-table-row cursor-pointer ${isSelected ? 'row-selected' : ''}`}
                      onClick={() => handleOpenWorkOrder(wo)}
                    >
                      {/* 0. CHECKBOX */}
                      <td className="td-checkbox wo-selection-column" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleWoSelection(wo.id, e)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select work order ${wo.order_number}`}
                        />
                      </td>

                      {/* 1. REQUEST */}
                      <td className="wo-cell-request">
                        <div className="wo-expandable-cell wo-request-expandable">
                        <div
                          className="wo-request-title"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenWorkOrder(wo);
                          }}
                          title="View order details"
                        >
                          {wo.title}
                        </div>
                        <div className="wo-request-requester">
                          {wo.requester_name || 'Anonymous'}
                        </div>
                        </div>
                      </td>

                      {/* 2. DATE */}
                      <td className="wo-cell-date">
                        <div className="wo-date-primary">
                          {formatDate(wo.created_at || wo.start_date)}
                        </div>
                        {wo.due_date && (
                          <div className="wo-date-due" title="Due Date">
                            Due: {formatDate(wo.due_date)}
                          </div>
                        )}
                      </td>

                      {/* 3. CATEGORY */}
                      <td className="wo-cell-category">
                        <div className="wo-task-code wo-task-code-row">
                          <span>{wo.category || 'General'}</span>
                          {wo.trade && (
                            <span className="wo-trade-badge" title={`Assigned trade: ${wo.trade}`}>
                              <Wrench size={10} />
                              {wo.trade}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 4. TASK TYPE */}
                      <td className="wo-cell-task-description">
                        <div className="wo-expandable-cell wo-task-expandable">
                        <div
                          className="wo-task-row"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenWorkOrder(wo);
                          }}
                        >
                          <FileText size={13} className="wo-task-icon" />
                          <span className="wo-task-title">{wo.task_type_name || wo.task_type_code || '—'}</span>
                        </div>
                        {wo.task_type_code && <div className="wo-task-code">{wo.task_type_code}</div>}
                        </div>
                      </td>

                      {/* 3. LOCATION */}
                      <td className="wo-cell-location">
                        <div className={`wo-linked-locations ${additionalLocationCount > 0 ? 'has-multiple' : ''}`}>
                          <div
                            className="wo-location-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (goToMap) {
                                goToMap(primaryLocation?.target || wo, primaryLocation?.type || 'workOrder');
                              }
                            }}
                            title="View on Floorplan Map"
                          >
                            <MapPin size={13} className="wo-location-pin" />
                            <span className="wo-location-text">{locTitle}</span>
                          </div>
                          <div className="wo-location-sub-row">
                            <span className="wo-location-sub">{subLocation}</span>
                            {additionalLocationCount > 0 && (
                              <span className="wo-location-more-count">+{additionalLocationCount}</span>
                            )}
                          </div>

                          {additionalLocationCount > 0 && (
                            <div className="wo-linked-locations-expanded">
                              <span className="wo-linked-locations-label">Linked locations</span>
                              {linkedLocations.map(location => (
                                <button
                                  key={location.id}
                                  type="button"
                                  className="wo-linked-location-option"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (goToMap) goToMap(location.target, location.type);
                                  }}
                                  title={`View ${location.label} on Floorplan Map`}
                                >
                                  {location.type === 'room' ? <Building size={12} /> : <Wrench size={12} />}
                                  <span>{location.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 4. STATUS & CLOSE BUTTON */}
                      <td className="wo-cell-status">
                        <div className="wo-status-wrapper">
                          {isCompleted ? (
                            <span className="wo-status-pill completed">
                              <span className="status-dot completed" />
                              <span>COMPLETED</span>
                            </span>
                          ) : isOnHold ? (
                            <span className="wo-status-pill on-hold">
                              <span className="status-dot on-hold" />
                              <span>ON HOLD</span>
                            </span>
                          ) : isCancelled ? (
                            <span className="wo-status-pill cancelled">
                              <span>CANCELLED</span>
                            </span>
                          ) : isPendingTriage ? (
                            <span
                              className="wo-status-pill triage cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                canTriage ? setTriagingWorkOrder(wo) : handleOpenWorkOrder(wo);
                              }}
                              title={canTriage ? "Triage request" : "View request details"}
                            >
                              <span className="status-dot open" />
                              <span>TRIAGE</span>
                            </span>
                          ) : (
                            <span className="wo-status-pill open">
                              <span className="status-dot open" />
                              <span>OPEN</span>
                            </span>
                          )}

                          {/* Quick Close Button right below the status */}
                          {canWrite && !isCompleted && !isCancelled && (canClose || (wo.assignees || []).some(u => u.username === currentUser?.username)) && (
                            <button
                              type="button"
                              className="wo-row-close-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setClosingWorkOrder(wo);
                              }}
                              title="Record labor hours and close ticket"
                            >
                              <Check size={13} className="wo-close-check" />
                              <span>Close</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 5. TECH */}
                      <td className="wo-cell-tech">
                        <div className="wo-tech-row">
                          <div className="wo-tech-avatar">
                            <User size={12} />
                          </div>
                          <span className={`wo-tech-name ${wo.assignees?.length ? '' : 'unassigned'}`}>
                            {techNames}
                          </span>
                        </div>
                        <div className="wo-tech-dept">
                          {techRole}
                        </div>
                      </td>

                      {/* 6. NUMBER & ACTIONS */}
                      <td className="wo-cell-number">
                        <div className="wo-number-row">
                          <span
                            className="wo-number-badge cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenWorkOrder(wo);
                            }}
                            title="Open work order"
                          >
                            {wo.order_number}
                          </span>
                          <button
                            type="button"
                            className="wo-row-print-btn"
                            onClick={(e) => handlePrintSingle(wo, e)}
                            title="Print Work Order"
                          >
                            <Printer size={13} />
                          </button>
                          <button
                            type="button"
                            className="wo-copy-btn"
                            onClick={(e) => handleCopyNumber(wo.order_number, wo.id, e)}
                            title="Copy Order Number"
                          >
                            {copiedId === wo.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================
          4. MOBILE CARD LIST VIEW
          ======================================================== */}
      <div className="wo-mobile-view" aria-live="polite">
        {isLoading && allWorkOrders.length === 0 ? (
          <div className="wo-mobile-list-state">
            <RefreshCw size={28} className="spinning" />
            <strong>Loading work orders…</strong>
          </div>
        ) : filteredWorkOrders.length === 0 ? (
          <div className="wo-mobile-list-state">
            <Filter size={32} />
            <strong>No matching work orders</strong>
            <span>{activeFilterCount > 0 ? 'Adjust or clear the active filters.' : 'Work orders will appear here when they are created.'}</span>
            {activeFilterCount > 0 && (
              <button type="button" className="btn btn-secondary" onClick={handleResetAll}>Clear filters</button>
            )}
          </div>
        ) : paginatedWorkOrders.map(wo => {
          const canCloseWorkOrder = canWrite && (canClose || (wo.assignees || []).some(user => user.username === currentUser?.username));
          const isTerminal = ['completed', 'cancelled', 'rejected'].includes(wo.status);
          return (
            <WorkOrderCard
              key={wo.id}
              workOrder={wo}
              isSelected={selectedWoIds.includes(wo.id)}
              onToggleSelect={toggleWoSelection}
              onSelect={() => handleOpenWorkOrder(wo)}
              onClose={!isTerminal && canCloseWorkOrder ? () => setClosingWorkOrder(wo) : undefined}
              onPrint={(order, e) => handlePrintSingle(order || wo, e)}
              goToMap={goToMap}
            />
          );
        })}
      </div>

      {/* ========================================================
          5. PAGINATION FOOTER
          ======================================================== */}
      {filteredWorkOrders.length > 0 && (
        <div className="wo-pagination-panel glass-panel flex-between p-md mt-md flex-wrap gap-md">
          <div className="items-center gap-lg">
            <span className="text-sm text-muted">
              Showing <strong className="text-primary">{((validCurrentPage - 1) * pageSize + 1).toLocaleString()}</strong> - <strong className="text-primary">{Math.min(validCurrentPage * pageSize, filteredWorkOrders.length).toLocaleString()}</strong> of <strong className="text-primary">{filteredWorkOrders.length.toLocaleString()}</strong> orders
            </span>

            <div className="items-center gap-xs">
              <span className="text-xs text-muted">Per page:</span>
              <select
                className="wo-pagesize-select"
                aria-label="Work orders per page"
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="items-center gap-xs">
            <button
              className="wo-page-btn"
              type="button"
              aria-label="First page"
              onClick={() => setCurrentPage(1)}
              disabled={validCurrentPage === 1}
            >
              <ChevronsLeft size={16} />
            </button>

            <button
              className="wo-page-btn"
              type="button"
              aria-label="Previous page"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={validCurrentPage === 1}
            >
              <ChevronLeft size={16} />
            </button>

            <span className="text-sm text-muted px-sm">
              Page <strong className="text-primary">{validCurrentPage}</strong> of <strong className="text-primary">{totalPages}</strong>
            </span>

            <button
              className="wo-page-btn"
              type="button"
              aria-label="Next page"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={validCurrentPage === totalPages}
            >
              <ChevronRight size={16} />
            </button>

            <button
              className="wo-page-btn"
              type="button"
              aria-label="Last page"
              onClick={() => setCurrentPage(totalPages)}
              disabled={validCurrentPage === totalPages}
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      )}
      </div>
      ) : (
        <div id="work-order-calendar-panel" role="tabpanel" aria-labelledby="work-order-calendar-tab">
          <WorkOrderCalendar
            workOrders={filteredWorkOrders}
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            categoryFilter={categoryFilter}
            tradeFilter={tradeFilter}
            techFilter={techFilter}
            dateFilter={dateFilter}
            searchQuery={searchQuery}
            onOpenWorkOrder={handleOpenWorkOrder}
            onOpenPMSchedule={setSelectedPMOccurrence}
          />
        </div>
      )}

      {/* ========================================================
          6. MODALS
          ======================================================== */}
      {/* Detail Modal */}
      {selectedWorkOrder && (
        <WorkOrderDetailModal
          workOrder={selectedWorkOrder}
          isOpen={Boolean(selectedWorkOrder)}
          onClose={() => setSelectedWorkOrder(null)}
          currentUser={currentUser}
          onUpdated={(updatedWo) => {
            if (updatedWo) setSelectedWorkOrder(updatedWo);
            if (loadWorkOrders) loadWorkOrders(true);
          }}
          onSelectMapLocation={goToMap}
        />
      )}

      {/* Triage Modal */}
      {triagingWorkOrder && (
        <WorkOrderTriageModal
          workOrder={triagingWorkOrder}
          isOpen={Boolean(triagingWorkOrder)}
          onClose={() => setTriagingWorkOrder(null)}
          currentUser={currentUser}
          onSuccess={() => {
            if (loadWorkOrders) loadWorkOrders(true);
          }}
        />
      )}

      {/* PM Scheduler Modal */}
      <PMSchedulerModal
        isOpen={isPMSchedulerOpen}
        onClose={() => setIsPMSchedulerOpen(false)}
        currentUser={currentUser}
        onWorkOrderGenerated={() => {
          if (loadWorkOrders) loadWorkOrders(true);
        }}
      />

      <PMScheduleDetailModal
        isOpen={Boolean(selectedPMOccurrence)}
        scheduleId={selectedPMOccurrence?.schedule_id}
        occurrence={selectedPMOccurrence}
        onClose={() => setSelectedPMOccurrence(null)}
      />

      {/* Quick Closeout Modal */}
      {closingWorkOrder && (
        <CloseWorkOrderModal
          workOrder={closingWorkOrder}
          onClose={() => setClosingWorkOrder(null)}
          onSuccess={() => {
            if (loadWorkOrders) loadWorkOrders(true);
          }}
        />
      )}

      {/* Bulk Assign Modal */}
      {isBulkAssignOpen && (
        <BulkAssignWorkOrdersModal
          isOpen={isBulkAssignOpen}
          onClose={() => setIsBulkAssignOpen(false)}
          selectedWorkOrders={selectedWorkOrdersList}
          currentUser={currentUser}
          onSuccess={handleBulkActionSuccess}
        />
      )}

      {/* Bulk Close Modal */}
      {isBulkCloseOpen && (
        <BulkCloseWorkOrdersModal
          isOpen={isBulkCloseOpen}
          onClose={() => setIsBulkCloseOpen(false)}
          selectedWorkOrders={selectedWorkOrdersList}
          onSuccess={handleBulkActionSuccess}
        />
      )}

      {/* Bulk Delete Modal */}
      {isBulkDeleteOpen && (
        <BulkDeleteWorkOrdersModal
          isOpen={isBulkDeleteOpen}
          onClose={() => setIsBulkDeleteOpen(false)}
          selectedWorkOrders={selectedWorkOrdersList}
          onSuccess={handleBulkActionSuccess}
        />
      )}

      {/* Print Modal */}
      {isPrintModalOpen && (
        <WorkOrderPrintModal
          isOpen={isPrintModalOpen}
          onClose={() => {
            setIsPrintModalOpen(false);
            setPrintingWorkOrders([]);
          }}
          workOrders={printingWorkOrders}
        />
      )}
    </div>
  );
}
