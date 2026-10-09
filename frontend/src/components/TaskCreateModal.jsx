import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Save, ListChecks, Plus, Trash2,
  Wrench, AlertTriangle, BookOpen
} from 'lucide-react';
import { createTask, updateTask, getAllEquipment, getAllRooms, getTrades, getTaskCategories, getErrorMessage } from '../api';
import AssetsOwnershipSection from './AssetsOwnershipSection';
import TradeQuickManageModal from './TradeQuickManageModal';
import './TaskModals.css';

export default function TaskCreateModal({
  isOpen,
  onClose,
  onTaskCreated,
  onTaskUpdated,
  taskToEdit = null,
  initialCategory = 'General',
  initialTrade = ''
}) {
  const isEditing = Boolean(taskToEdit && taskToEdit.id);

  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(initialCategory || 'General');
  const [trade, setTrade] = useState(initialTrade || '');
  const [estimatedHours, setEstimatedHours] = useState('1.0');
  const [pmTaskSheet, setPmTaskSheet] = useState('');
  const [checklistItems, setChecklistItems] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState([]);

  // Quick checklist addition state
  const [newStepText, setNewStepText] = useState('');
  const [newStepType, setNewStepType] = useState('checkbox');
  const [newStepUnit, setNewStepUnit] = useState('');

  // Trades state & modal
  const [tradesList, setTradesList] = useState([]);
  const [taskCategories, setTaskCategories] = useState([]);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadTradesList = () => {
    getTrades()
      .then(res => setTradesList(res.data || []))
      .catch(() => setTradesList([]));
  };

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setError(null);
      loadTradesList();
      getTaskCategories({ include_inactive: false })
        .then(res => setTaskCategories(res.data || []))
        .catch(() => setTaskCategories([]));
      Promise.all([getAllRooms(), getAllEquipment()])
        .then(([roomsResult, equipmentResult]) => {
          setRooms(roomsResult.data || []);
          setEquipment(equipmentResult.data || []);
        })
        .catch(() => {
          setRooms([]);
          setEquipment([]);
        });

      if (taskToEdit) {
        setCode(taskToEdit.code || '');
        setDescription(taskToEdit.description || '');
        setCategory(taskToEdit.category || 'General');
        setTrade(taskToEdit.trade || '');
        setEstimatedHours(taskToEdit.estimated_hours ? String(taskToEdit.estimated_hours) : '1.0');
        setPmTaskSheet(taskToEdit.pm_task_sheet || '');
        setChecklistItems(Array.isArray(taskToEdit.checklist_items) ? taskToEdit.checklist_items : []);
        setIsActive(taskToEdit.is_active !== false);
        setSelectedRoomIds((taskToEdit.rooms || []).map(room => room.id));
        setSelectedEquipmentIds((taskToEdit.equipment || []).map(item => item.id));
      } else {
        setCode('');
        setDescription('');
        setCategory(initialCategory || 'General');
        setTrade(initialTrade || '');
        setEstimatedHours('1.0');
        setPmTaskSheet('');
        setChecklistItems([]);
        setIsActive(true);
        setSelectedRoomIds([]);
        setSelectedEquipmentIds([]);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, taskToEdit, initialCategory, initialTrade]);

  const handleAddStep = () => {
    if (!newStepText.trim()) return;
    const item = {
      id: crypto.randomUUID(),
      task: newStepText.trim(),
      type: newStepType,
      required: true
    };
    if (newStepType === 'reading' && newStepUnit.trim()) {
      item.unit = newStepUnit.trim();
    }
    setChecklistItems(prev => [...prev, item]);
    setNewStepText('');
    setNewStepUnit('');
  };

  const handleRemoveStep = (index) => {
    setChecklistItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      setError("Please enter a task title / description.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      code: code.trim() || null,
      description: description.trim(),
      category: category.trim() || 'General',
      trade: trade.trim() || null,
      estimated_hours: Math.max(0.1, parseFloat(estimatedHours) || 1.0),
      pm_task_sheet: pmTaskSheet.trim() || null,
      checklist_items: checklistItems,
      is_active: isActive,
      room_ids: selectedRoomIds,
      equipment_ids: selectedEquipmentIds
    };

    try {
      if (isEditing) {
        const res = await updateTask(taskToEdit.id, payload);
        if (onTaskUpdated) {
          onTaskUpdated(res.data);
        }
      } else {
        const res = await createTask(payload);
        if (onTaskCreated) {
          onTaskCreated(res.data);
        }
      }
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, isEditing ? "Failed to update task sheet." : "Failed to create task sheet."));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // This modal can be opened from TaskSelectModal, which uses z-index 1250.
  return createPortal(
    <div className="modal-overlay modal-backdrop-dark task-modal-layer-create" onClick={onClose}>
      <div
        className="modal-card modal-lg glass-panel task-create-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-create-title"
      >
        {/* Header */}
        <div className="modal-card-header">
          <div className="task-modal-heading">
            <div className="icon-box-primary task-modal-icon">
              <BookOpen size={18} />
            </div>
            <div className="task-modal-heading-copy">
              <h3 id="task-create-title">
                {isEditing ? 'Edit task sheet' : 'New task sheet'}
              </h3>
              <p>
                {isEditing ? 'Update procedure text, checklist steps, trade, and labor estimate.' : 'Create a reusable procedure sheet with optional checklist steps.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-sm task-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close task sheet form"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="task-create-form">
          <div className="modal-card-body task-modal-body">
            {error && (
              <div className="alert-box-danger-left flex items-center gap-sm" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Task Title */}
            <div className="task-form-field">
              <label htmlFor="task-template-description">Task sheet name</label>
              <input
                id="task-template-description"
                type="text"
                required
                autoFocus
                placeholder="e.g. Annual Emergency Generator Full-Load Test"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="input-field task-title-input"
              />
            </div>

            <div className="task-form-grid">
              <div className="task-form-field">
                <label htmlFor="task-template-code">Task code</label>
                <input id="task-template-code" className="input-field" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. HV00002" />
              </div>
              <div className="task-form-field">
                <label htmlFor="task-template-category">Task category</label>
                <select
                  id="task-template-category"
                  className="input-field"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  {taskCategories.map(item => (
                    <option key={item.name} value={item.name}>{item.name}</option>
                  ))}
                  {category && !taskCategories.some(item => item.name === category) && <option value={category}>{category}</option>}
                </select>
              </div>
            </div>

            <div className="task-form-grid">
              <div className="task-form-field">
                <div className="task-modal-field-heading">
                  <label htmlFor="task-template-trade">
                    Assigned trade / specialty
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setIsTradeModalOpen(true)}
                    title="Add or Edit Trades"
                  >
                    <Wrench size={11} />
                    <span>Manage trades</span>
                  </button>
                </div>

                <div className="task-trade-control">
                  <select
                    id="task-template-trade"
                    className="input-field"
                    value={trade}
                    onChange={e => {
                      if (e.target.value === '__add_or_edit__') {
                        setIsTradeModalOpen(true);
                      } else {
                        setTrade(e.target.value);
                      }
                    }}
                  >
                    <option value="">Select trade (optional)</option>
                    {tradesList.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option disabled>──────────</option>
                    <option value="__add_or_edit__">
                      Add or edit trades…
                    </option>
                  </select>

                  <button
                    type="button"
                    className="btn btn-secondary btn-icon-sm task-trade-manage-button"
                    onClick={() => setIsTradeModalOpen(true)}
                    title="Add or Edit Trades"
                    aria-label="Add or edit trades"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>

              <div className="task-form-field">
                <label htmlFor="task-template-hours">Estimated labor</label>
                <div className="pm-input-suffix">
                  <input
                    id="task-template-hours"
                    type="number"
                    min="0"
                    step="any"
                    className="input-field"
                    value={estimatedHours}
                    onChange={e => setEstimatedHours(e.target.value)}
                  />
                  <span>hours</span>
                </div>
              </div>
            </div>

            {/* Optional task sheet */}
            <div className="task-form-field">
              <label htmlFor="task-template-instructions">
                Task sheet <span className="text-muted">Optional</span>
              </label>
              <textarea
                id="task-template-instructions"
                className="input-field task-instructions-input"
                rows={4}
                placeholder="Detailed step-by-step procedural instructions, required tools, testing parameters, or manufacturer guidelines..."
                value={pmTaskSheet}
                onChange={e => setPmTaskSheet(e.target.value)}
              />
            </div>

            <AssetsOwnershipSection
              headingId="task-assets-heading"
              title="Default assets"
              description="These rooms and equipment are available when this template is used in a PM schedule."
              equipment={equipment}
              selectedEquipmentIds={selectedEquipmentIds}
              onToggleEquipment={id => setSelectedEquipmentIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
              onClearEquipment={() => setSelectedEquipmentIds([])}
              equipmentPlaceholder="Search equipment to link to this task..."
              rooms={rooms}
              selectedRoomIds={selectedRoomIds}
              onToggleRoom={id => setSelectedRoomIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
              onClearRooms={() => setSelectedRoomIds([])}
              roomPlaceholder="Search rooms to link to this task..."
            />

            {/* Interactive Checklist Builder */}
            <section className="task-modal-section" aria-labelledby="task-checklist-heading">
              <div className="task-checklist-heading">
                <div className="task-modal-section-heading is-checklist">
                  <ListChecks size={16} />
                  <strong id="task-checklist-heading">Procedural step checklist</strong>
                </div>
                <span>{checklistItems.length} steps configured</span>
              </div>

              {checklistItems.length > 0 && (
                <div className="task-checklist-items">
                  {checklistItems.map((item, index) => (
                    <div className="task-checklist-item" key={item.id || index}>
                      <span className="task-checklist-index">{index + 1}</span>
                      <div className="task-checklist-copy">
                        <strong>{item.task}</strong>
                        <small>
                          {item.type === 'reading' ? `Reading${item.unit ? ` (${item.unit})` : ''}` : item.type === 'pass-fail' ? 'Pass / Fail' : 'Checkbox'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon-xs text-danger"
                        title="Remove checklist item"
                        aria-label={`Remove checklist item ${index + 1}`}
                        onClick={() => handleRemoveStep(index)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Step Row */}
              <div className="task-checklist-add">
                <input
                  type="text"
                  className="input-field task-checklist-add-text"
                  placeholder="Add an inspection or verification step..."
                  value={newStepText}
                  onChange={e => setNewStepText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddStep();
                    }
                  }}
                />
                <select
                  className="input-field task-checklist-add-type"
                  aria-label="Checklist step type"
                  value={newStepType}
                  onChange={e => setNewStepType(e.target.value)}
                >
                  <option value="checkbox">Checkbox</option>
                  <option value="pass-fail">Pass / Fail</option>
                  <option value="reading">Reading</option>
                </select>
                {newStepType === 'reading' && (
                  <input
                    type="text"
                    className="input-field task-checklist-add-unit"
                    placeholder="Unit (PSI, V)"
                    value={newStepUnit}
                    onChange={e => setNewStepUnit(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddStep}
                >
                  <Plus size={14} /> Add step
                </button>
              </div>
            </section>

            {/* Active Toggle */}
            <label className="pm-active-toggle task-active-toggle">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>
                <strong>{isEditing ? 'Task is active' : 'Make active immediately'}</strong>
                <small>Active tasks are available across work order creation and PM schedules.</small>
              </span>
            </label>

          </div>

          {/* Footer Save Bar */}
          <div className="modal-card-footer task-modal-footer">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm gap-xs"
              disabled={saving}
            >
              <Save size={14} />
              <span>{saving ? 'Saving…' : (isEditing ? 'Save changes' : 'Create task sheet')}</span>
            </button>
          </div>
        </form>
      </div>

      <TradeQuickManageModal
        isOpen={isTradeModalOpen}
        onClose={() => setIsTradeModalOpen(false)}
        onTradeCreated={(createdTradeName) => {
          loadTradesList();
          setTrade(createdTradeName);
        }}
        onTradeUpdated={(oldName, newName) => {
          loadTradesList();
          if (trade === oldName) {
            setTrade(newName);
          }
        }}
        onTradeDeleted={(deletedName, reassignTo) => {
          loadTradesList();
          if (trade === deletedName) {
            setTrade(reassignTo || '');
          }
        }}
      />
    </div>,
    document.body
  );
}
