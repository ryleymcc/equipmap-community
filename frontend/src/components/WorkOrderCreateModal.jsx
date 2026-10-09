import { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Wrench, Send,
  CheckCircle2, AlertTriangle, Copy, Check, Plus, Clock, User, Edit3
} from 'lucide-react';
import {
  getSites, getFloorplans, getRooms, getEquipment,
  getAllRooms, getAllEquipment, getAssignableUsers, getTrades,
  createWorkOrder, getErrorMessage, getTask, getTaskTypes
} from '../api';
import EntitySearchSelector from './EntitySearchSelector';
import AssetsOwnershipSection from './AssetsOwnershipSection';
import TaskSelectModal from './TaskSelectModal';
import TaskTemplateLinkSelector from './TaskTemplateLinkSelector';
import WorkOrderEditModal from './WorkOrderEditModal';
import './WorkOrderCreateModal.css';

const CATEGORIES = [
  'General', 'Plumbing', 'HVAC', 'Electrical',
  'Doors & Locks', 'Lighting', 'Furniture', 'Cleaning',
  'Preventive Maintenance', 'Safety'
];

const getNowDateTimeString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getTaskEntityDefaults = (task) => {
  const rooms = Array.isArray(task?.rooms) ? task.rooms : [];
  const equipment = Array.isArray(task?.equipment) ? task.equipment : [];
  const linkedEntities = [...rooms, ...equipment];
  const siteIds = [...new Set(linkedEntities.map(entity => entity.site_id).filter(Boolean))];
  const floorplanIds = [...new Set(linkedEntities.map(entity => entity.floorplan_id).filter(Boolean))];

  return {
    roomIds: rooms.map(room => room.id),
    equipmentIds: equipment.map(item => item.id),
    siteId: siteIds.length === 1 ? String(siteIds[0]) : '',
    floorplanId: floorplanIds.length === 1 ? String(floorplanIds[0]) : '',
  };
};

export default function WorkOrderCreateModal({
  isOpen,
  onClose,
  onCreated,
  initialSiteId = null,
  initialFloorplanId = null,
  initialRoomId = null,
  initialEquipmentId = null,
  initialTask = null,
  currentUser
}) {
  const modalTitleId = useId();
  const successTitleId = useId();
  const titleInputRef = useRef(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [trade, setTrade] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('auto');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [availableTaskTypes, setAvailableTaskTypes] = useState([]);
  const [taskTypesLoading, setTaskTypesLoading] = useState(true);

  // Task template reference & extra fields
  const [linkedTask, setLinkedTask] = useState(initialTask);
  const [checklistItems, setChecklistItems] = useState([]);
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);

  // Trades list
  const [availableTrades, setAvailableTrades] = useState([]);

  // Location
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId ? String(initialSiteId) : '');
  const [floorplans, setFloorplans] = useState([]);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState(initialFloorplanId ? String(initialFloorplanId) : '');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState(initialRoomId ? [initialRoomId] : []);
  const [availableEquipment, setAvailableEquipment] = useState([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState(initialEquipmentId ? [initialEquipmentId] : []);
  const [locationDetails, setLocationDetails] = useState('');

  // Assignees & Scheduling
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState(
    currentUser?.id ? [currentUser.id] : []
  );
  const [startDate, setStartDate] = useState(() => getNowDateTimeString());
  const [dueDate, setDueDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('1.0');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Success Confirmation State
  const [createdWorkOrder, setCreatedWorkOrder] = useState(null);
  const [copiedOrderNumber, setCopiedOrderNumber] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Initialize form from initialTask if present
  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setTaskTypeId('');
      if (initialTask) {
        const entityDefaults = getTaskEntityDefaults(initialTask);
        setLinkedTask(initialTask);
        setTitle(initialTask.description || '');
        setDescription(initialTask.pm_task_sheet || initialTask.description || '');
        setCategory(initialTask.category || 'General');
        setTrade(initialTask.trade || '');
        setEstimatedHours(String(initialTask.estimated_hours || 1.0));
        setChecklistItems(initialTask.checklist_items || []);
        setSelectedRoomIds(entityDefaults.roomIds);
        setSelectedEquipmentIds(entityDefaults.equipmentIds);
        setSelectedSiteId(entityDefaults.siteId);
        setSelectedFloorplanId(entityDefaults.floorplanId);
      } else {
        setLinkedTask(null);
        setTitle('');
        setDescription('');
        setCategory('General');
        setTrade('');
        setEstimatedHours('1.0');
        setChecklistItems([]);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, initialTask]);

  // Load Sites, Assignable Users, & Trades
  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => setStartDate(getNowDateTimeString()), 0);

    getSites()
      .then(res => setSites(res.data || []))
      .catch(err => console.error("Error loading sites:", err));

    getAssignableUsers()
      .then(res => {
        const list = res.data || [];
        list.sort((a, b) => {
          const nameA = (a.full_name || a.username || '').toLowerCase();
          const nameB = (b.full_name || b.username || '').toLowerCase();
          return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
        });
        setAssignableUsers(list);
      })
      .catch(err => console.error("Error loading assignable users:", err));

    getTrades()
      .then(res => setAvailableTrades(res.data || []))
      .catch(err => console.error("Error loading trades:", err));

    getTaskTypes()
      .then(res => setAvailableTaskTypes(res.data || []))
      .catch(err => console.error("Error loading task types:", err))
      .finally(() => setTaskTypesLoading(false));
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  // Load Floorplans when Site changes
  useEffect(() => {
    if (!isOpen) return;

    if (!selectedSiteId) {
      return;
    }
    getFloorplans(selectedSiteId)
      .then(res => {
        setFloorplans(res.data || []);
      })
      .catch(err => console.error("Error loading floorplans:", err));
  }, [isOpen, selectedSiteId]);

  // Load Rooms & Equipment: floorplan-specific, site-wide, or campus-wide
  useEffect(() => {
    if (!isOpen) return;

    if (selectedFloorplanId) {
      // Specific floorplan
      getRooms(selectedFloorplanId)
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getEquipment(selectedFloorplanId)
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    } else if (selectedSiteId) {
      // Specific site across all floorplans
      const siteNum = parseInt(selectedSiteId, 10);
      getAllRooms()
        .then(res => setAvailableRooms((res.data || []).filter(r => r.site_id === siteNum)))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment((res.data || []).filter(e => e.site_id === siteNum)))
        .catch(() => setAvailableEquipment([]));
    } else {
      // All sites & floors (Campus-wide / No specific site)
      getAllRooms()
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    }
  }, [isOpen, selectedFloorplanId, selectedSiteId]);

  const toggleRoom = (id) => {
    setSelectedRoomIds(prev =>
      prev.includes(id) ? prev.filter(rId => rId !== id) : [...prev, id]
    );
  };

  const toggleEquipment = (id) => {
    setSelectedEquipmentIds(prev =>
      prev.includes(id) ? prev.filter(eId => eId !== id) : [...prev, id]
    );
  };

  const toggleAssignee = (id) => {
    setSelectedAssigneeIds(prev =>
      prev.includes(id) ? prev.filter(uId => uId !== id) : [...prev, id]
    );
  };

  const handleSelectTask = (task) => {
    const entityDefaults = getTaskEntityDefaults(task);
    setLinkedTask(task);
    if (!title.trim()) {
      setTitle(task.description || '');
    }
    if (!description.trim()) {
      setDescription(task.pm_task_sheet || task.description || '');
    }
    if (task.category) setCategory(task.category);
    if (task.trade) setTrade(task.trade);
    if (task.estimated_hours) setEstimatedHours(String(task.estimated_hours));
    if (Array.isArray(task.checklist_items) && task.checklist_items.length > 0) {
      setChecklistItems(task.checklist_items);
    }
    setSelectedRoomIds(entityDefaults.roomIds);
    setSelectedEquipmentIds(entityDefaults.equipmentIds);
    setSelectedSiteId(entityDefaults.siteId);
    setSelectedFloorplanId(entityDefaults.floorplanId);
    setFloorplans([]);
  };

  const handleTaskTypeChange = async (event) => {
    const nextId = event.target.value;
    setTaskTypeId(nextId);
    if (!nextId) return;

    const selectedType = availableTaskTypes.find(item => String(item.id) === nextId);
    if (!selectedType) return;
    setCategory(selectedType.category || 'General');
    setPriority(selectedType.priority || 'medium');
    setTrade(selectedType.trade || '');

    if (!selectedType.task_sheet_id) return;
    try {
      const taskSheet = (await getTask(selectedType.task_sheet_id)).data;
      setLinkedTask(taskSheet);
      if (Array.isArray(taskSheet.checklist_items)) {
        setChecklistItems(taskSheet.checklist_items);
      }
    } catch (err) {
      console.error('Error loading linked task sheet:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      titleInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Determine location_type
    let locType = 'none';
    const linkedEntityCount = selectedRoomIds.length + selectedEquipmentIds.length;
    if (linkedEntityCount > 1) {
      locType = 'multi';
    } else if (selectedEquipmentIds.length === 1) {
      locType = 'equipment';
    } else if (selectedRoomIds.length === 1) {
      locType = 'room';
    } else if (selectedFloorplanId) {
      locType = 'pin';
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      trade: trade.trim() || undefined,
      priority,
      status: status === 'auto' ? undefined : status,
      location_type: locType,
      site_id: selectedSiteId ? parseInt(selectedSiteId, 10) : undefined,
      floorplan_id: selectedFloorplanId ? parseInt(selectedFloorplanId, 10) : undefined,
      room_ids: selectedRoomIds,
      equipment_ids: selectedEquipmentIds,
      location_details: locationDetails.trim() || undefined,
      assigned_user_ids: selectedAssigneeIds,
      start_date: startDate ? new Date(startDate).toISOString() : undefined,
      due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      estimated_hours: parseFloat(estimatedHours) || 0.0,
      requester_name: currentUser?.full_name || currentUser?.username || 'Staff',
      task_type_id: taskTypeId ? Number(taskTypeId) : undefined,
      task_id: linkedTask?.id || undefined,
      checklist_items: checklistItems || [],
    };

    try {
      const res = await createWorkOrder(payload);
      setCreatedWorkOrder(res.data);
      if (onCreated) onCreated(res.data);
    } catch (err) {
      console.error('Error creating work order:', err);
      setError(getErrorMessage(err, 'Failed to create work order.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAnother = () => {
    setCreatedWorkOrder(null);
    setError(null);
    setLinkedTask(null);
    setTitle('');
    setDescription('');
    setCategory('General');
    setTrade('');
    setPriority('medium');
    setStatus('auto');
    setTaskTypeId('');
    setSelectedRoomIds([]);
    setSelectedEquipmentIds([]);
    setLocationDetails('');
    setEstimatedHours('1.0');
    setDueDate('');
    setStartDate(getNowDateTimeString());
    setChecklistItems([]);
  };

  const handleCopyOrderNumber = () => {
    if (!createdWorkOrder?.order_number) return;
    navigator.clipboard.writeText(createdWorkOrder.order_number);
    setCopiedOrderNumber(true);
    setTimeout(() => setCopiedOrderNumber(false), 2000);
  };

  const handleDone = () => {
    setCreatedWorkOrder(null);
    onClose();
  };

  const handleFormKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  };

  // Dynamic placeholders
  const siteObj = sites.find(s => String(s.id) === String(selectedSiteId));
  const floorObj = floorplans.find(f => String(f.id) === String(selectedFloorplanId));

  const roomPlaceholder = floorObj
    ? `Search rooms on ${floorObj.name}...`
    : siteObj
      ? `Search rooms in ${siteObj.name}...`
      : 'Search all rooms across all buildings & floors...';

  const equipPlaceholder = floorObj
    ? `Search equipment on ${floorObj.name}...`
    : siteObj
      ? `Search equipment in ${siteObj.name}...`
      : 'Search all equipment across all buildings & floors...';

  // Ensure current trade is in list if not empty
  const tradesDisplayList = [...availableTrades];
  if (trade && !tradesDisplayList.includes(trade)) {
    tradesDisplayList.unshift(trade);
  }

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark" onClick={handleDone}>
      {createdWorkOrder ? (
        <div
          className="modal-card modal-lg glass-panel wo-create-modal wo-create-success-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={successTitleId}
          onClick={e => e.stopPropagation()}
        >
          <div className="modal-card-header wo-create-modal-header">
            <div className="wo-create-header-title">
              <div className="icon-box-success" aria-hidden="true">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h2 id={successTitleId}>Work order created</h2>
                <p>The new work order is ready for dispatch.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDone}
              className="btn btn-ghost btn-icon-sm"
              aria-label="Close work order confirmation"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="modal-card-body wo-create-success-body">
            <section className="wo-create-success-banner" aria-label="Creation confirmation">
              <div className="wo-create-success-icon" aria-hidden="true">
                <CheckCircle2 size={28} />
              </div>
              <div>
                <h3>Work order created successfully</h3>
                <p>The work order has been recorded and placed in the maintenance dispatch queue.</p>
              </div>
              <div className="wo-create-tracking-number">
                <span>Tracking number</span>
                <strong>{createdWorkOrder.order_number}</strong>
                <button
                  type="button"
                  onClick={handleCopyOrderNumber}
                  className="btn btn-ghost btn-icon-xs"
                  aria-label={copiedOrderNumber ? 'Work order number copied' : 'Copy work order number'}
                  title={copiedOrderNumber ? 'Copied' : 'Copy work order number'}
                >
                  {copiedOrderNumber ? <Check size={14} className="wo-create-copy-success" /> : <Copy size={14} />}
                </button>
              </div>
            </section>

            <section className="wo-create-success-summary" aria-label="Created work order summary">
              <div className="wo-create-success-title-block">
                <span className="wo-create-eyebrow">Work order</span>
                <h3>{createdWorkOrder.title}</h3>
                <div className="wo-create-badge-row">
                  <span className="permission-pill badge-primary">{createdWorkOrder.category || 'General'}</span>
                  {createdWorkOrder.task_type_name && (
                    <span className="permission-pill badge-neutral">Task type: {createdWorkOrder.task_type_name}</span>
                  )}
                  {createdWorkOrder.trade && (
                    <span className="permission-pill badge-info">Trade: {createdWorkOrder.trade}</span>
                  )}
                  <span className={`permission-pill ${
                    ['urgent', 'emergency'].includes(createdWorkOrder.priority) ? 'badge-danger' :
                    createdWorkOrder.priority === 'high' ? 'badge-warning' : 'badge-neutral'
                  }`}>
                    Priority: {createdWorkOrder.priority}
                  </span>
                  <span className={`permission-pill ${
                    createdWorkOrder.status === 'in_progress' ? 'badge-success' :
                    createdWorkOrder.status === 'pending_triage' ? 'badge-warning' : 'badge-info'
                  }`}>
                    Status: {createdWorkOrder.status?.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div className="wo-create-success-grid">
                <div>
                  <span className="wo-create-eyebrow">Location</span>
                  <div className="wo-create-summary-lines">
                    {siteObj && <div><strong>Site:</strong> {siteObj.name}</div>}
                    {floorObj && <div><strong>Floor:</strong> {floorObj.name}</div>}
                    {createdWorkOrder.rooms?.length > 0 && (
                      <div><strong>Rooms:</strong> {createdWorkOrder.rooms.map(r => r.name).join(', ')}</div>
                    )}
                    {createdWorkOrder.equipment?.length > 0 && (
                      <div><strong>Equipment:</strong> {createdWorkOrder.equipment.map(e => e.name).join(', ')}</div>
                    )}
                    {createdWorkOrder.location_details && (
                      <div className="wo-create-summary-muted">{createdWorkOrder.location_details}</div>
                    )}
                    {!siteObj && !createdWorkOrder.rooms?.length && !createdWorkOrder.equipment?.length && !createdWorkOrder.location_details && (
                      <span className="wo-create-summary-muted">General campus location</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="wo-create-eyebrow">Assignment</span>
                  {createdWorkOrder.assignees?.length > 0 ? (
                    <div className="wo-create-badge-row">
                      {createdWorkOrder.assignees.map(user => (
                        <span key={user.id} className="badge badge-info">
                          {user.full_name || user.username}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="wo-create-unassigned">
                      {createdWorkOrder.status === 'pending_triage' ? 'Pending triage review' : 'Unassigned'}
                    </span>
                  )}
                  <div className="wo-create-summary-meta">
                    Estimated labor: <strong>{createdWorkOrder.estimated_hours || 0} hrs</strong>
                  </div>
                </div>
              </div>

              {(createdWorkOrder.task_sheet || createdWorkOrder.checklist_items?.length > 0) && (
                <div className="wo-create-success-reference">
                  {createdWorkOrder.task_description && (
                    <div>Linked task sheet: <strong>{createdWorkOrder.task_description}</strong></div>
                  )}
                  {createdWorkOrder.checklist_items?.length > 0 && (
                    <div className="wo-create-checklist-count">
                      <CheckCircle2 size={14} aria-hidden="true" />
                      {createdWorkOrder.checklist_items.length} procedural checklist steps included
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="modal-card-footer wo-create-success-footer">
            <button type="button" onClick={handleCreateAnother} className="btn btn-secondary btn-sm">
              <Plus size={14} />
              <span>Create another</span>
            </button>
            <div className="wo-create-footer-actions">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="btn btn-secondary btn-sm"
                title="Edit the details of this created work order"
              >
                <Edit3 size={14} />
                <span>Edit work order</span>
              </button>
              <button type="button" onClick={handleDone} className="btn btn-primary btn-sm">
                <Check size={14} />
                <span>Done</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="modal-card modal-xl glass-panel wo-create-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          onClick={e => e.stopPropagation()}
        >
          <div className="modal-card-header wo-create-modal-header">
            <div className="wo-create-header-title">
              <div className="icon-box-primary" aria-hidden="true">
                <Wrench size={18} />
              </div>
              <div>
                <h2 id={modalTitleId}>{linkedTask ? 'Create work order from task sheet' : 'Create work order'}</h2>
                <p>Describe the work, then place and assign it.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon-sm"
              aria-label="Close create work order modal"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="wo-create-form-shell">
            <div className="modal-card-body wo-create-form-body">
              {error && (
                <div className="wo-create-error" role="alert">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <div>
                    <strong>Could not create work order</strong>
                    <span>{error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="btn btn-ghost btn-icon-xs"
                    aria-label="Dismiss error"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="wo-create-primary-fields">
                <div className="wo-create-field">
                  <label htmlFor="wo-create-title">
                    <span>Work order title</span>
                    <span className="wo-create-label-required">Required</span>
                  </label>
                  <input
                    ref={titleInputRef}
                    id="wo-create-title"
                    type="text"
                    className="input-field wo-create-title-input"
                    placeholder="e.g. Replace AHU-1 air filter"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    aria-invalid={error === 'Title is required'}
                    required
                  />
                </div>

                <div className="wo-create-field">
                  <label htmlFor="wo-create-description">
                    <span>Description</span>
                    <span className="wo-create-label-meta">Add the useful context first</span>
                  </label>
                  <textarea
                    id="wo-create-description"
                    className="input-field wo-create-description"
                    rows={3}
                    placeholder="Describe the issue, expected result, access notes, tools, or required parts..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </div>

                <div className="wo-create-metadata-grid">
                  <div className="wo-create-field">
                    <label htmlFor="wo-create-category">Category</label>
                    <select id="wo-create-category" className="input-field" value={category} onChange={e => setCategory(e.target.value)}>
                      {CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-task-type">
                      <span>Task type</span>
                      <span className="wo-create-label-meta">Optional</span>
                    </label>
                    <select id="wo-create-task-type" className="input-field" value={taskTypeId} onChange={handleTaskTypeChange} disabled={taskTypesLoading}>
                      <option value="">{taskTypesLoading ? 'Loading task types…' : 'No task type'}</option>
                      {!taskTypesLoading && availableTaskTypes.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                    </select>
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-priority">Priority</label>
                    <select id="wo-create-priority" className="input-field" value={priority} onChange={e => setPriority(e.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Critical</option>
                    </select>
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-status">Initial status</label>
                    <select id="wo-create-status" className="input-field" value={status} onChange={e => setStatus(e.target.value)}>
                      <option value="auto">Auto ({selectedAssigneeIds.length > 0 ? 'Assigned' : 'Unassigned'})</option>
                      <option value="unassigned">Unassigned</option>
                      <option value="assigned">Assigned</option>
                      <option value="in_progress">In progress</option>
                      <option value="on_hold">On hold</option>
                    </select>
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-trade">
                      <span>Assigned trade</span>
                      <span className="wo-create-label-meta">Optional</span>
                    </label>
                    <select id="wo-create-trade" className="input-field" value={trade} onChange={e => setTrade(e.target.value)}>
                      <option value="">None / General</option>
                      {tradesDisplayList.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>
                </div>

                <div className="wo-create-field">
                  <span className="wo-create-field-label">Linked task sheet</span>
                  <TaskTemplateLinkSelector
                    linkedTask={linkedTask}
                    checklistCount={checklistItems.length}
                    onOpen={() => setIsTaskSelectOpen(true)}
                    onUnlink={() => setLinkedTask(null)}
                    emptyText="Link an existing task sheet to pre-fill instructions, checklist, time, and linked rooms or equipment"
                  />
                </div>
              </div>

              <AssetsOwnershipSection
                headingId="wo-create-assets-heading"
                title="Location & assets"
                description="Choose a broad area or attach exact rooms and equipment."
                sites={sites}
                floorplans={floorplans}
                selectedSiteId={selectedSiteId}
                selectedFloorplanId={selectedFloorplanId}
                onSiteChange={value => {
                  setSelectedSiteId(value);
                  setSelectedFloorplanId('');
                  setFloorplans([]);
                }}
                onFloorplanChange={setSelectedFloorplanId}
                siteAllLabel="Campus-wide / Any site"
                equipment={availableEquipment}
                selectedEquipmentIds={selectedEquipmentIds}
                onToggleEquipment={toggleEquipment}
                onClearEquipment={() => setSelectedEquipmentIds([])}
                equipmentPlaceholder={equipPlaceholder}
                rooms={availableRooms}
                selectedRoomIds={selectedRoomIds}
                onToggleRoom={toggleRoom}
                onClearRooms={() => setSelectedRoomIds([])}
                roomPlaceholder={roomPlaceholder}
              >
                <div className="wo-create-field">
                  <label htmlFor="wo-create-location-details">
                    <span>Location notes</span>
                    <span className="wo-create-label-meta">Optional</span>
                  </label>
                  <input
                    id="wo-create-location-details"
                    type="text"
                    className="input-field"
                    placeholder="Access instructions, landmarks, or key requirements..."
                    value={locationDetails}
                    onChange={e => setLocationDetails(e.target.value)}
                  />
                </div>
              </AssetsOwnershipSection>

              <section className="wo-create-section" aria-labelledby="wo-create-assignment-heading">
                <div className="wo-create-section-heading">
                  <div className="wo-create-section-icon" aria-hidden="true"><User size={15} /></div>
                  <div>
                    <h3 id="wo-create-assignment-heading">Assignment &amp; Schedule</h3>
                    <p>Set ownership and timing without leaving the form.</p>
                  </div>
                </div>

                <EntitySearchSelector
                  entityType="technician"
                  label="Assignees"
                  items={assignableUsers}
                  selectedIds={selectedAssigneeIds}
                  onToggle={toggleAssignee}
                  onClearAll={() => setSelectedAssigneeIds([])}
                  placeholder="Search staff and technicians..."
                />

                <div className="wo-create-schedule-grid">
                  <div className="wo-create-field">
                    <label htmlFor="wo-create-start">
                      <span>Start</span>
                      <span className="wo-create-label-meta">Optional</span>
                    </label>
                    <input id="wo-create-start" type="datetime-local" className="input-field" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-due">
                      <span>Due</span>
                      <span className="wo-create-label-meta">Optional</span>
                    </label>
                    <input id="wo-create-due" type="datetime-local" className="input-field" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </div>

                  <div className="wo-create-field">
                    <label htmlFor="wo-create-hours">Estimated hours</label>
                    <input id="wo-create-hours" type="number" step="any" min="0" className="input-field" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} />
                  </div>
                </div>
              </section>
            </div>

            <div className="modal-card-footer wo-create-modal-footer">
              <div className="wo-create-footer-note">
                <Clock size={14} aria-hidden="true" />
                Required fields must be completed
              </div>
              <div className="wo-create-footer-actions">
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="btn btn-primary btn-sm">
                  <Send size={14} />
                  <span>{isSubmitting ? 'Creating...' : 'Create work order'}</span>
                </button>
              </div>
            </div>
          </form>

          {isTaskSelectOpen && (
            <TaskSelectModal
              isOpen={isTaskSelectOpen}
              onClose={() => setIsTaskSelectOpen(false)}
              onSelectTask={handleSelectTask}
            title="Select task sheet to link"
            subtitle="Link a standard task sheet to pre-populate instructions and checklist items."
            actionButtonLabel="Link task sheet"
              currentLinkedTaskId={linkedTask?.id}
            />
          )}
        </div>
      )}

      {isEditModalOpen && createdWorkOrder && (
        <WorkOrderEditModal
          workOrder={createdWorkOrder}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          currentUser={currentUser}
          onUpdated={(updatedWo) => {
            setCreatedWorkOrder(updatedWo);
            if (onCreated) onCreated(updatedWo);
          }}
        />
      )}
    </div>,
    document.body
  );
}
