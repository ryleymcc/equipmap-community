import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  getTasks, updateTask, deleteTask, getTrades, getTaskCategories, getErrorMessage
} from '../api';
import {
  BookOpen, Plus, Search, Filter, Wrench, Clock, ListChecks,
  CheckCircle2, AlertTriangle, Edit2, Trash2,
  Eye, Menu, X, Calendar, RefreshCw, ChevronDown, ChevronUp, Layers,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight
} from 'lucide-react';
import DashboardLeftDrawer from '../components/DashboardLeftDrawer';
import TaskCreateModal from '../components/TaskCreateModal';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskCategoriesPanel from '../components/TaskCategoriesPanel';
import TaskTypesPanel from '../components/TaskTypesPanel';
import PMSchedulerModal from '../components/PMSchedulerModal';
import './TaskManagement.css';

const DEFAULT_PAGE_SIZE = 50;

export default function TaskManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, canCreatePM, loading } = useAuth();

  const [tasks, setTasks] = useState([]);
  const [trades, setTrades] = useState([]);
  const [taskCategories, setTaskCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTrade, setSelectedTrade] = useState(() => {
    return searchParams.get('trade') || 'All';
  });
  const [statusFilter, setStatusFilter] = useState('active'); // 'all' | 'active' | 'inactive'
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [activeTab, setActiveTab] = useState('types');

  // Sync trade parameter from URL
  useEffect(() => {
    const tradeParam = searchParams.get('trade');
    if (tradeParam) {
      const timeoutId = window.setTimeout(() => {
        setSelectedTrade(tradeParam);
        setCurrentPage(1);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [searchParams]);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState(null);
  const [inspectingTask, setInspectingTask] = useState(null);
  const [isPMStudioOpen, setIsPMStudioOpen] = useState(false);
  const [pmStudioSearch, setPmStudioSearch] = useState('');
  const [pmStudioTask, setPmStudioTask] = useState(null);

  const handleOpenPMSchedulerForTask = (task) => {
    setPmStudioSearch(task?.code || task?.description || '');
    setPmStudioTask(task || null);
    setIsPMStudioOpen(true);
  };

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const [tasksRes, tradesRes, categoriesRes] = await Promise.all([
        getTasks({ limit: 2000 }),
        getTrades(),
        getTaskCategories()
      ]);
      setTasks(tasksRes.data || []);
      setTrades(tradesRes.data || []);
      setTaskCategories(categoriesRes.data || []);
    } catch (err) {
      console.error('Failed to load tasks:', err);
      setLoadError(getErrorMessage(err, 'Failed to load task types.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate('/login', { state: { from: location } });
      } else if (!canCreatePM) {
        navigate('/', { replace: true });
      } else {
        const timeoutId = window.setTimeout(fetchTasks, 0);
        return () => window.clearTimeout(timeoutId);
      }
    }
    return undefined;
  }, [loading, user, canCreatePM, navigate, location]);

  const tabTasks = useMemo(
    () => activeTab === 'sheets'
      ? tasks.filter(task => Boolean(task.pm_task_sheet && task.pm_task_sheet.trim()))
      : tasks,
    [activeTab, tasks]
  );

  const categoryCounts = useMemo(() => {
    const counts = { All: tabTasks.length };
    tabTasks.forEach(t => {
      let cat = t.category || 'General';
      if (cat.toLowerCase() === 'general maintenance') cat = 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [tabTasks]);

  const filteredTasks = useMemo(() => {
    return tabTasks.filter(t => {
      // Category filter
      if (selectedCategory !== 'All') {
        const cat = (t.category || 'General').toLowerCase();
        if (cat !== selectedCategory.toLowerCase()) return false;
      }

      // Trade filter
      if (selectedTrade !== 'All') {
        if (!t.trade || t.trade.toLowerCase() !== selectedTrade.toLowerCase()) return false;
      }

      // Status filter
      if (statusFilter === 'active' && t.is_active === false) return false;
      if (statusFilter === 'inactive' && t.is_active !== false) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCode = (t.code || '').toLowerCase().includes(q);
        const matchTitle = (t.description || '').toLowerCase().includes(q);
        const matchSheet = (t.pm_task_sheet || '').toLowerCase().includes(q);
        const matchTrade = (t.trade || '').toLowerCase().includes(q);
        const matchCat = (t.category || '').toLowerCase().includes(q);
        if (!matchCode && !matchTitle && !matchSheet && !matchTrade && !matchCat) return false;
      }

      return true;
    });
  }, [tabTasks, selectedCategory, selectedTrade, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const visiblePage = Math.min(currentPage, totalPages);
  const pageStart = (visiblePage - 1) * pageSize;
  const paginatedTasks = useMemo(
    () => filteredTasks.slice(pageStart, pageStart + pageSize),
    [filteredTasks, pageSize, pageStart]
  );
  const pageEnd = Math.min(pageStart + paginatedTasks.length, filteredTasks.length);

  // Key stats
  const activeCount = tabTasks.filter(t => t.is_active !== false).length;
  const withSOPCount = tasks.filter(t => Boolean(t.pm_task_sheet && t.pm_task_sheet.trim())).length;
  const pmLinkedCount = tasks.filter(t => (t.pm_schedules_count || 0) > 0).length;
  const totalPMSchedulesCount = tasks.reduce((sum, t) => sum + (t.pm_schedules_count || 0), 0);
  const activeFilterCount = [
    searchQuery.trim(),
    selectedCategory !== 'All',
    selectedTrade !== 'All',
    statusFilter !== 'active'
  ].filter(Boolean).length;

  const handleToggleActive = async (task) => {
    try {
      const updatedStatus = task.is_active === false;
      await updateTask(task.id, { is_active: updatedStatus });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_active: updatedStatus } : t));
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to update task status'));
    }
  };

  const handleDeleteTask = async (task) => {
    const isLinked = (task.pm_schedules_count || 0) > 0 || (task.work_orders_count || 0) > 0;
    const confirmMsg = isLinked
      ? `Task "${task.description}" is linked to active PM schedules or work orders. Deleting it will deactivate it instead. Proceed?`
      : `Are you sure you want to permanently delete task type "${task.description}"?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteTask(task.id);
      fetchTasks();
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to delete task'));
    }
  };

  if (loading || !user || !canCreatePM) return null;

  const canManage = canCreatePM;

  return (
    <div className="app-layout">
      <DashboardLeftDrawer
        isOpen={isLeftDrawerOpen}
        onClose={() => setIsLeftDrawerOpen(false)}
        activeView="tasks"
      />

      <div className="main-content">
        {/* Header Bar */}
        <header className="app-header dashboard-header">
          <button className="trigger-btn" onClick={() => setIsLeftDrawerOpen(true)} title="Open menu" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="task-management-header-title">
            <div className="task-management-title-group">
              <BookOpen size={22} className="text-primary" />
              <h1>Tasks</h1>
            </div>
            {activeTab !== 'categories' && <span className="badge badge-secondary task-management-count">{filteredTasks.length} {activeTab === 'sheets' ? 'task sheets' : 'task types'}</span>}
          </div>

          <div className="task-management-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm gap-xs"
              onClick={fetchTasks}
              title="Refresh tasks"
              aria-label="Refresh tasks"
            >
              <RefreshCw size={15} />
              <span className="task-refresh-label">Refresh</span>
            </button>

            {canManage && activeTab === 'sheets' && (
              <button
                type="button"
                className="btn btn-primary btn-sm gap-xs"
                onClick={() => {
                  setTaskToEdit(null);
                  setIsCreateModalOpen(true);
                }}
              >
                <Plus size={16} />
                <span>Add task sheet</span>
              </button>
            )}
          </div>
        </header>

        <div className="list-view-container task-management-content">
          <div className="task-management-tabs" role="tablist" aria-label="Task management sections">
            <button type="button" role="tab" aria-selected={activeTab === 'types'} className={activeTab === 'types' ? 'is-active' : ''} onClick={() => setActiveTab('types')}><BookOpen size={16} /> Task types</button>
            <button type="button" role="tab" aria-selected={activeTab === 'sheets'} className={activeTab === 'sheets' ? 'is-active' : ''} onClick={() => setActiveTab('sheets')}><ListChecks size={16} /> Task sheets</button>
            <button type="button" role="tab" aria-selected={activeTab === 'categories'} className={activeTab === 'categories' ? 'is-active' : ''} onClick={() => setActiveTab('categories')}><Layers size={16} /> Task categories</button>
          </div>
          {activeTab === 'categories' ? (
            <TaskCategoriesPanel onCategoriesChanged={fetchTasks} />
          ) : activeTab === 'types' ? (
            <TaskTypesPanel categories={taskCategories} trades={trades} taskSheets={tasks} />
          ) : <>
          {/* Metrics Row */}
          <div className="task-metrics-row">
            <div className="task-metric-card">
              <div className="task-metric-label is-primary">
                <BookOpen size={14} />
                <span>Total {activeTab === 'sheets' ? 'task sheets' : 'task types'}</span>
              </div>
              <div className="task-metric-value">{tabTasks.length}</div>
            </div>

            <div className="task-metric-card">
              <div className="task-metric-label is-success">
                <CheckCircle2 size={14} />
                <span>Active for dispatch</span>
              </div>
              <div className="task-metric-value">{activeCount}</div>
            </div>

            <button
              type="button"
              className="task-metric-card"
              onClick={() => {
                setPmStudioSearch('');
                setIsPMStudioOpen(true);
              }}
              title="Open PM Schedule Builder"
            >
              <div className="task-metric-label is-info">
                <Calendar size={14} />
                <span>Linked to PM schedules</span>
              </div>
              <div className="task-metric-value">{pmLinkedCount}</div>
              <div className="task-metric-note">
                {totalPMSchedulesCount.toLocaleString()} active PM schedule{totalPMSchedulesCount !== 1 ? 's' : ''}
              </div>
            </button>

            <div className="task-metric-card">
              <div className="task-metric-label is-primary">
                <ListChecks size={14} />
                <span>Task sheets</span>
              </div>
              <div className="task-metric-value">{withSOPCount}</div>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="task-filter-card glass-panel">
            <button
              type="button"
              className="task-mobile-filter-toggle"
              onClick={() => setIsMobileFiltersOpen(open => !open)}
              aria-expanded={isMobileFiltersOpen}
              aria-controls="task-filter-panel"
            >
              <span className="task-mobile-filter-toggle-label">
                <Filter size={16} />
                <span>Filters</span>
              </span>
              <span className="task-mobile-filter-toggle-actions">
                {activeFilterCount > 0 && (
                  <span className="task-mobile-filter-count">{activeFilterCount} active</span>
                )}
                {isMobileFiltersOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </span>
            </button>

            <div
              id="task-filter-panel"
              className={`task-filter-content ${isMobileFiltersOpen ? 'is-mobile-filter-open' : ''}`}
            >
            <div className="filter-toolbar-row">
              {/* Search Bar */}
              <div className="filter-search-control task-filter-search">
                <Search size={15} className="filter-search-icon" />
                <input
                  type="text"
                  className="input-field filter-control"
                  placeholder={activeTab === 'sheets' ? 'Search task sheets...' : 'Search task types by code or name...'}
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label={activeTab === 'sheets' ? 'Search task sheets' : 'Search task types'}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCurrentPage(1);
                    }}
                    className="filter-clear-btn"
                    aria-label="Clear task search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Trade, Type & Status Dropdowns */}
              <div className="filter-select-group">
                <select
                  className="input-field filter-control task-filter-select"
                  value={selectedTrade}
                  onChange={e => {
                    setSelectedTrade(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter by trade"
                >
                  <option value="All">All Trades</option>
                  {trades.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {selectedTrade !== 'All' && !trades.includes(selectedTrade) && (
                    <option value={selectedTrade}>{selectedTrade}</option>
                  )}
                </select>

                <select
                  className="input-field filter-control task-filter-select"
                  value={statusFilter}
                  onChange={e => {
                    setStatusFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter by status"
                >
                  <option value="active">Active Only</option>
                  <option value="all">All Statuses</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="task-category-filters" aria-label="Filter by category">
              {['All', ...taskCategories.map(item => item.name)].map(cat => {
                const isSelected = selectedCategory === cat;
                const count = categoryCounts[cat] || 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`task-category-button ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setCurrentPage(1);
                    }}
                    aria-pressed={isSelected}
                  >
                    <span>{cat}</span>
                    <span className="task-category-count">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>

          {/* Tasks Table / Cards */}
          {isLoading ? (
            <div className="task-list-state flex-center p-2xl" role="status">
              <div className="loader">Loading {activeTab === 'sheets' ? 'task sheets' : 'task types'}...</div>
            </div>
          ) : loadError ? (
            <div className="task-list-state task-list-error glass-panel empty-state-box" role="alert">
              <AlertTriangle size={28} className="text-danger" />
              <h3>{activeTab === 'sheets' ? 'Task sheets' : 'Task types'} could not be loaded</h3>
              <p>{loadError}</p>
              <button type="button" className="btn btn-secondary" onClick={fetchTasks}>Retry</button>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="task-list-state empty-state-box glass-panel">
              <BookOpen size={36} className="text-muted mb-sm opacity-50" />
              <h3>No {activeTab === 'sheets' ? 'task sheets' : 'task types'} found</h3>
              <p className="text-xs text-muted mt-xs mb-md">
                {searchQuery ? `No ${activeTab === 'sheets' ? 'task sheets' : 'task types'} match "${searchQuery}"` : `No ${activeTab === 'sheets' ? 'task sheets' : 'task types'} match the selected filters.`}
              </p>
              {canManage && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setTaskToEdit(null);
                    setIsCreateModalOpen(true);
                  }}
                >
                  <Plus size={15} />
                  <span>Create task type</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="table-desktop-view">
                <div className="list-table-wrapper">
                  <table className="list-table task-list-table">
                    <thead>
                      <tr>
                        <th>Task sheet</th>
                        <th>Task category</th>
                        <th>Trade</th>
                        <th>Labor</th>
                        <th>Checklist</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedTasks.map(t => {
                        const checklistCount = Array.isArray(t.checklist_items) ? t.checklist_items.length : 0;
                        const isActive = t.is_active !== false;

                        return (
                          <tr key={t.id}>
                            <td className="task-template-cell">
                              <div className="task-template-heading">
                                {t.code && <span className="task-select-code">{t.code}</span>}
                                <span className="task-template-title">
                                  {t.description}
                                </span>
                                {t.pm_schedules_count > 0 && (
                                  <button
                                    type="button"
                                    className="badge badge-purple task-pm-link task-fit-badge"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenPMSchedulerForTask(t);
                                    }}
                                    title={`Open PM Schedule Builder for "${t.description}"`}
                                  >
                                    <Calendar size={10} />
                                    <span>{t.pm_schedules_count} PM schedule{t.pm_schedules_count > 1 ? 's' : ''}</span>
                                  </button>
                                )}
                                {((t.equipment?.length > 0) || (t.rooms?.length > 0)) && (
                                  <span
                                    className="badge badge-info task-fit-badge"
                                    title={`Linked to ${[t.equipment?.length ? `${t.equipment.length} equipment` : '', t.rooms?.length ? `${t.rooms.length} room${t.rooms.length !== 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}`}
                                  >
                                    <Layers size={10} />
                                    <span>{[t.equipment?.length ? `${t.equipment.length} equip` : '', t.rooms?.length ? `${t.rooms.length} room${t.rooms.length !== 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="permission-pill badge-info task-fit-badge">
                                {t.category || 'General'}
                              </span>
                            </td>
                            <td>
                              {t.trade ? (
                                <span className="permission-pill badge-purple task-fit-badge">
                                  <Wrench size={11} />
                                  <span>{t.trade}</span>
                                </span>
                              ) : (
                                <span className="text-muted text-xs">—</span>
                              )}
                            </td>
                            <td>
                              <span className="text-xs font-semibold text-secondary flex items-center gap-2xs">
                                <Clock size={12} className="text-muted" />
                                <span>{t.estimated_hours || 1.0} hr</span>
                              </span>
                            </td>
                            <td>
                              {checklistCount > 0 ? (
                                <span className="badge badge-secondary gap-xs">
                                  <ListChecks size={12} />
                                  <span>{checklistCount} steps</span>
                                </span>
                              ) : (
                                <span className="text-muted text-xs">—</span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`badge task-status-button ${isActive ? 'badge-success' : 'badge-secondary'}`}
                                onClick={() => handleToggleActive(t)}
                                disabled={!canManage}
                                title={canManage ? `Click to change status to ${isActive ? 'Inactive' : 'Active'}` : ''}
                              >
                                <div className={`badge-dot ${isActive ? 'active' : 'inactive'}`} />
                                <span>{isActive ? 'Active' : 'Inactive'}</span>
                              </button>
                            </td>
                            <td>
                              <div className="task-row-actions">
                                <button
                                  className="row-action-btn"
                                  onClick={() => setInspectingTask(t)}
                                  title="Inspect Task & Procedure"
                                >
                                  <Eye size={16} />
                                </button>
                                {canManage && (
                                  <>
                                    <button
                                      className="row-action-btn"
                                      onClick={() => {
                                        setTaskToEdit(t);
                                        setIsCreateModalOpen(true);
                                      }}
                                      title="Edit task sheet"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                    <button
                                      className="row-action-btn delete-btn"
                                      onClick={() => handleDeleteTask(t)}
                                      title="Delete / Deactivate Task"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards View */}
              <div className="table-mobile-view">
                {paginatedTasks.map(t => {
                  const checklistCount = Array.isArray(t.checklist_items) ? t.checklist_items.length : 0;
                  const isActive = t.is_active !== false;

                  return (
                    <article key={t.id} className="table-mobile-card glass-panel task-mobile-card">
                      <div className="task-mobile-card-header">
                        <div className="task-mobile-card-copy">
                          <div className="flex items-center gap-xs flex-wrap">
                            <span className="permission-pill badge-info">
                              {t.category || 'General'}
                            </span>
                            {t.trade && (
                              <span className="permission-pill badge-purple">
                                <Wrench size={10} />
                                <span>{t.trade}</span>
                              </span>
                            )}
                            {((t.equipment?.length > 0) || (t.rooms?.length > 0)) && (
                              <span className="badge badge-info task-fit-badge">
                                <Layers size={10} />
                                <span>{[t.equipment?.length ? `${t.equipment.length} equip` : '', t.rooms?.length ? `${t.rooms.length} room${t.rooms.length !== 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}</span>
                              </span>
                            )}
                          </div>
                          <h3 className="task-template-title">
                            {t.description}
                          </h3>
                          {t.code && <span className="task-select-code">{t.code}</span>}
                        </div>

                        <div className="task-row-actions">
                          <button
                            type="button"
                            className="row-action-btn"
                            onClick={() => setInspectingTask(t)}
                            title="Inspect Task"
                          >
                            <Eye size={15} />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                className="row-action-btn"
                                onClick={() => {
                                  setTaskToEdit(t);
                                  setIsCreateModalOpen(true);
                                }}
                                title="Edit task sheet"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                type="button"
                                className="row-action-btn delete-btn"
                                onClick={() => handleDeleteTask(t)}
                                title="Delete Task"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Footer Metrics on Mobile */}
                      <div className="task-mobile-card-footer">
                        <span className="text-xs text-secondary flex items-center gap-2xs">
                          <Clock size={11} className="text-muted" />
                          <span>{t.estimated_hours || 1.0} hr</span>
                        </span>
                        {checklistCount > 0 && (
                          <span className="badge badge-secondary">
                            <ListChecks size={10} />
                            <span>{checklistCount} steps</span>
                          </span>
                        )}
                        {t.pm_schedules_count > 0 && (
                          <button
                            type="button"
                            className="badge badge-purple task-pm-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenPMSchedulerForTask(t);
                            }}
                            title={`Open PM Schedule Builder for "${t.description}"`}
                          >
                            <Calendar size={10} />
                            <span>{t.pm_schedules_count} PM{t.pm_schedules_count > 1 ? 's' : ''}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`badge task-status-button task-mobile-status ${isActive ? 'badge-success' : 'badge-secondary'}`}
                          onClick={() => handleToggleActive(t)}
                          disabled={!canManage}
                        >
                          <div className={`badge-dot ${isActive ? 'active' : 'inactive'}`} />
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <nav className="task-pagination glass-panel" aria-label={activeTab === 'sheets' ? 'Task sheet pages' : 'Task type pages'}>
                <div className="task-pagination-summary">
                  <span>
                    Showing <strong>{pageStart + 1}</strong>–<strong>{pageEnd}</strong> of <strong>{filteredTasks.length}</strong> {activeTab === 'sheets' ? 'task sheets' : 'task types'}
                  </span>
                  <label className="task-pagination-size-label" htmlFor="task-template-page-size">
                    <span>Per page</span>
                    <select
                      id="task-template-page-size"
                      className="input-field task-pagination-size"
                      value={pageSize}
                      onChange={e => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                    </select>
                  </label>
                </div>

                <div className="task-pagination-controls">
                  <button
                    type="button"
                    className="btn btn-ghost task-pagination-button"
                    onClick={() => setCurrentPage(1)}
                    disabled={visiblePage === 1}
                    title="First page"
                    aria-label="First task page"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost task-pagination-button"
                    onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                    disabled={visiblePage === 1}
                    title="Previous page"
                    aria-label="Previous task page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="task-pagination-page">
                    Page <strong>{visiblePage}</strong> of <strong>{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost task-pagination-button"
                    onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                    disabled={visiblePage === totalPages}
                    title="Next page"
                    aria-label="Next task page"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost task-pagination-button"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={visiblePage === totalPages}
                    title="Last page"
                    aria-label="Last task page"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>
              </nav>
            </>
          )}
          </>}
        </div>
      </div>

      {/* Task Create / Edit Modal */}
      <TaskCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setTaskToEdit(null);
        }}
        taskToEdit={taskToEdit}
        onTaskCreated={() => {
          fetchTasks();
        }}
        onTaskUpdated={() => {
          fetchTasks();
        }}
      />

      {/* Task Detail / Inspect Modal */}
      <TaskDetailModal
        task={inspectingTask}
        isOpen={Boolean(inspectingTask)}
        onClose={() => setInspectingTask(null)}
        onOpenPMSchedules={handleOpenPMSchedulerForTask}
        onEdit={canManage ? (t) => {
          setInspectingTask(null);
          setTaskToEdit(t);
          setIsCreateModalOpen(true);
        } : null}
      />

      {/* PM Scheduler Studio Modal */}
      {isPMStudioOpen && (
        <PMSchedulerModal
          isOpen={isPMStudioOpen}
          onClose={() => {
            setIsPMStudioOpen(false);
            setPmStudioSearch('');
            setPmStudioTask(null);
          }}
          currentUser={user}
          initialSearch={pmStudioSearch}
          initialTask={pmStudioTask}
          onWorkOrderGenerated={() => {
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}
