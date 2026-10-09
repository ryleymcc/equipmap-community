import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, ListChecks, Clock, Check, CheckSquare,
  ChevronRight, ChevronDown, Plus, ArrowRight, RefreshCw, FileText, Edit2
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { getTasks, getErrorMessage } from '../api';
import TaskCreateModal from './TaskCreateModal';
import './TaskModals.css';

export default function TaskSelectModal({
  isOpen,
  onClose,
  onSelectTask,
  title = "Create Work Order from Task",
  subtitle = "Choose a standard procedural task to instantly populate work order instructions, checklists, and labor estimates.",
  actionButtonLabel = "Create Work Order",
  currentLinkedTaskId = null,
}) {
  const { canCreatePM } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState(null);

  const fetchTasks = () => {
    setLoading(true);
    setError(null);
    getTasks({ limit: 1000 })
      .then(res => {
        setTasks(res.data || []);
      })
      .catch(err => {
        setError(getErrorMessage(err, "Failed to load task types."));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(fetchTasks, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  const categoryCounts = useMemo(() => {
    const counts = { All: tasks.length };
    tasks.forEach(t => {
      let cat = t.category || 'General';
      if (cat.toLowerCase() === 'general maintenance') cat = 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [tasks]);

  const availableCategories = useMemo(() => {
    const defaultOrder = ['All', 'General', 'HVAC', 'Electrical', 'Plumbing', 'Safety', 'Doors & Locks', 'Facility & Grounds', 'Preventive Maintenance'];
    const presentCats = Object.keys(categoryCounts);
    const ordered = defaultOrder.filter(c => presentCats.includes(c));
    presentCats.forEach(c => {
      if (!ordered.includes(c)) ordered.push(c);
    });
    return ordered;
  }, [categoryCounts]);

  // Filter tasks in memory
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = tasks.filter(t => {
      // Category match
      if (selectedCategory !== 'All') {
        let cat = (t.category || 'General').toLowerCase();
        if (cat === 'general maintenance') cat = 'general';
        const sel = selectedCategory.toLowerCase();
        if (cat !== sel) return false;
      }
      // Query match
      if (!q) return true;
      const descMatch = (t.description || '').toLowerCase().includes(q);
      const sheetMatch = (t.pm_task_sheet || '').toLowerCase().includes(q);
      const tradeMatch = (t.trade || '').toLowerCase().includes(q);
      const categoryMatch = (t.category || '').toLowerCase().includes(q);
      return descMatch || sheetMatch || categoryMatch || tradeMatch;
    });

    if (currentLinkedTaskId == null) return matches;
    return matches.toSorted((a, b) => {
      const aIsCurrent = String(a.id) === String(currentLinkedTaskId);
      const bIsCurrent = String(b.id) === String(currentLinkedTaskId);
      return Number(bIsCurrent) - Number(aIsCurrent);
    });
  }, [tasks, searchQuery, selectedCategory, currentLinkedTaskId]);

  const toggleExpand = (taskId, e) => {
    if (e) e.stopPropagation();
    setExpandedTaskId(prev => prev === taskId ? null : taskId);
  };

  const handleSelect = (task) => {
    if (onSelectTask) {
      onSelectTask(task);
    }
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark task-modal-layer-select" onClick={onClose}>
      <div
        className="modal-card modal-xl glass-panel task-select-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-select-title"
      >
        {/* Header */}
        <div className="modal-card-header">
          <div className="task-modal-heading">
            <div className="icon-box-primary task-modal-icon">
              <ListChecks size={18} />
            </div>
            <div className="task-modal-heading-copy">
              <h3 id="task-select-title">
                {title}
              </h3>
              <p>
                {subtitle}
              </p>
            </div>
          </div>
          <div className="task-select-header-actions">
            {canCreatePM && (
              <button
                type="button"
                className="btn btn-primary btn-sm gap-xs"
                onClick={() => {
                  setTaskToEdit(null);
                  setIsCreateModalOpen(true);
                }}
              >
                <Plus size={14} />
                <span>New task type</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-icon-sm task-modal-close"
              onClick={onClose}
              title="Close"
              aria-label="Close task selector"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="task-select-toolbar">
          <div className="task-select-search">
            <Search size={16} />
            <input
              type="text"
              className="input-field"
              placeholder="Search task types by name, category, trade, or task sheet..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Search task types"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="task-select-search-clear"
                aria-label="Clear task search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="task-select-filter-pills" aria-label="Filter tasks by category">
            {availableCategories.map(cat => {
              const count = categoryCounts[cat] || 0;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`task-select-filter-pill ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                >
                  <span>{cat}</span>
                  <span className="task-select-filter-count">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Task List */}
        <div className="task-select-list">
          {loading ? (
            <div className="task-select-state empty-state-box" role="status">
              <RefreshCw className="pm-spin" size={24} />
              <div>Loading task library...</div>
            </div>
          ) : error ? (
            <div className="task-select-state empty-state-box task-list-error" role="alert">
              <ListChecks size={32} className="text-danger" />
              <h3>Task library could not be loaded</h3>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary" onClick={fetchTasks}>Retry</button>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="task-select-state empty-state-box">
              <ListChecks size={36} className="empty-state-icon" />
              <h3>No tasks found</h3>
              <p>
                {searchQuery ? `No task types found matching "${searchQuery}"` : "No task types found in this category."}
              </p>
              {canCreatePM && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setTaskToEdit(null);
                    setIsCreateModalOpen(true);
                  }}
                >
                  <Plus size={14} />
                  <span>Create task type</span>
                </button>
              )}
            </div>
          ) : (
            filteredTasks.map(task => {
              const isExpanded = expandedTaskId === task.id;
              const checklistCount = Array.isArray(task.checklist_items) ? task.checklist_items.length : 0;
              const hasSheet = Boolean(task.pm_task_sheet && task.pm_task_sheet.trim());
              const isCurrentLinked = currentLinkedTaskId != null && String(task.id) === String(currentLinkedTaskId);

              return (
                <div
                  key={task.id}
                  className={`task-select-card ${isExpanded ? 'is-expanded' : ''} ${isCurrentLinked ? 'is-current-linked' : ''}`}
                  aria-current={isCurrentLinked ? 'true' : undefined}
                >
                  {/* Top Bar: Category, Badges & Action */}
                  <div className="task-select-card-header">
                    <div className="task-select-card-copy">
                      <div className="task-select-card-badges">
                        {task.code && (
                          <span className="task-select-code">
                            {task.code}
                          </span>
                        )}
                        {isCurrentLinked && (
                          <span className="task-select-current-badge">
                            <Check size={12} /> Currently linked
                          </span>
                        )}
                        <span className="badge badge-secondary">
                          {task.category || 'General'}
                        </span>
                        {task.trade && (
                          <span className="badge badge-primary">
                            {task.trade}
                          </span>
                        )}
                        <span className="task-select-hours">
                          <Clock size={12} /> {task.estimated_hours || 1.0}h
                        </span>
                      </div>

                      <h4>
                        {task.description}
                      </h4>

                      {task.pm_task_sheet && !isExpanded && (
                        <p className="task-select-summary">
                          {task.pm_task_sheet}
                        </p>
                      )}
                    </div>

                    <div className="task-select-card-actions">
                      {canCreatePM && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTaskToEdit(task);
                            setIsCreateModalOpen(true);
                          }}
                          title="Edit task type"
                          aria-label={`Edit ${task.description}`}
                        >
                          <Edit2 size={13} />
                        </button>
                      )}

                      {(hasSheet || checklistCount > 0) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => toggleExpand(task.id, e)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <>Hide <ChevronDown size={14} /></>
                          ) : (
                            <>Preview <ChevronRight size={14} /></>
                          )}
                        </button>
                      )}
                      {isCurrentLinked ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm task-select-already-linked"
                          disabled
                        >
                          <Check size={14} />
                          <span>Already linked</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleSelect(task)}
                        >
                          <span>{actionButtonLabel}</span>
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Preview Drawer */}
                  {isExpanded && (
                    <div className="task-select-preview">
                      {checklistCount > 0 && (
                        <div>
                          <div className="task-select-preview-heading is-checklist">
                            <CheckSquare size={14} /> Procedural checklist ({checklistCount} steps)
                          </div>
                          <div className="task-select-preview-list">
                            {task.checklist_items.map((item, idx) => (
                              <div key={item.id || idx} className="task-select-preview-step">
                                <span>{idx + 1}.</span>
                                <span>{item.task || item.text || item.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {hasSheet && (
                        <div>
                          <div className="task-select-preview-heading is-procedure">
                            <FileText size={14} /> Task sheet
                          </div>
                          <div className="task-select-preview-procedure">
                            {task.pm_task_sheet}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="modal-card-footer justify-between text-xs text-muted">
          <div>
            Showing <strong>{filteredTasks.length}</strong> of <strong>{tasks.length}</strong> tasks
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>

      {isCreateModalOpen && (
        <TaskCreateModal
          isOpen={isCreateModalOpen}
          onClose={() => {
            setIsCreateModalOpen(false);
            setTaskToEdit(null);
          }}
          taskToEdit={taskToEdit}
          initialCategory={selectedCategory !== 'All' ? selectedCategory : 'General'}
          onTaskCreated={(newTask) => {
            setTasks(prev => [newTask, ...prev]);
            setExpandedTaskId(newTask.id);
          }}
          onTaskUpdated={(updatedTask) => {
            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
          }}
        />
      )}
    </div>,
    document.body
  );
}
