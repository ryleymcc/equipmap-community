import { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Wrench, Save,
  Trash2, Plus, CheckSquare, User, Check, ShieldAlert
} from 'lucide-react';
import {
  getSites, getFloorplans, getRooms, getEquipment,
  getAllRooms, getAllEquipment, getAssignableUsers,
  getTrades, getTask, getTaskTypes, updateWorkOrder, addWorkOrderComment, getErrorMessage
} from '../api';
import { useAuth } from '../AuthContext';
import EntitySearchSelector from './EntitySearchSelector';
import AssetsOwnershipSection from './AssetsOwnershipSection';
import TaskSelectModal from './TaskSelectModal';
import TaskTemplateLinkSelector from './TaskTemplateLinkSelector';
import { stripRepeatedWorkOrderTitle } from '../utils/workOrderDescription';
import './WorkOrderEditModal.css';

const CATEGORIES = [
  'General', 'Plumbing', 'HVAC', 'Electrical',
  'Doors & Locks', 'Lighting', 'Furniture', 'Cleaning',
  'Preventive Maintenance', 'Safety'
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Critical / Urgent' }
];

const STATUS_OPTIONS = [
  { value: 'pending_triage', label: 'Pending Triage' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rejected', label: 'Rejected' },
];

const TRIAGE_STATUS_OPTIONS = [
  { value: 'approve', label: 'Approve Request' },
  { value: 'in_progress', label: 'Approve & Start Work' },
  { value: 'on_hold', label: 'Approve & Put On Hold' },
  { value: 'cancelled', label: 'Reject Request' },
];

const getLocalDateTimeString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export default function WorkOrderEditModal(props) {
  if (!props.isOpen || !props.workOrder) return null;

  return <WorkOrderEditModalContent {...props} />;
}

function WorkOrderEditModalContent({
  workOrder,
  onClose,
  onUpdated,
  currentUser,
  variant = 'edit',
}) {
  const { user: authUser } = useAuth();
  const effectiveUser = currentUser || authUser;
  const modalTitleId = useId();
  const titleInputRef = useRef(null);
  const isAdm = effectiveUser?.role === 'admin';
  const canAssign = Boolean(isAdm || effectiveUser?.can_assign || effectiveUser?.can_triage);
  const isTriage = variant === 'triage';
  const isPendingTriage = workOrder.status === 'pending_triage';

  // Basic Info
  const [title, setTitle] = useState(workOrder.title || '');
  const initialDescription = stripRepeatedWorkOrderTitle(
    workOrder.title,
    workOrder.description,
  );
  const [description, setDescription] = useState(initialDescription);
  const [category, setCategory] = useState(workOrder.category || 'General');
  const [trade, setTrade] = useState(workOrder.trade || '');
  const [priority, setPriority] = useState(workOrder.priority || 'medium');
  const [taskTypeId, setTaskTypeId] = useState(workOrder.task_type_id ? String(workOrder.task_type_id) : '');
  const [availableTaskTypes, setAvailableTaskTypes] = useState([]);
  const [taskTypesLoading, setTaskTypesLoading] = useState(true);
  const [status, setStatus] = useState(() => {
    if (!isTriage) return workOrder.status || 'unassigned';
    if (isPendingTriage) return 'approve';
    return ['assigned', 'unassigned'].includes(workOrder.status) ? 'approve' : (workOrder.status || 'approve');
  });

  // Task Template
  const [linkedTask, setLinkedTask] = useState(
    (workOrder.task_sheet_id || workOrder.task_id)
      ? {
          id: workOrder.task_sheet_id || workOrder.task_id,
          code: workOrder.task_code,
          description: workOrder.task_description || workOrder.task_code || `Task #${workOrder.task_id}`,
          pm_task_sheet: workOrder.task_sheet
        }
      : null
  );
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);

  // Checklist Items
  const [checklistItems, setChecklistItems] = useState(
    Array.isArray(workOrder.checklist_items) ? workOrder.checklist_items : []
  );
  const [newStepText, setNewStepText] = useState('');
  const [newStepType, setNewStepType] = useState('checkbox');
  const [newStepUnit, setNewStepUnit] = useState('');

  // Location
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(
    workOrder.site_id ? String(workOrder.site_id) : (workOrder.floorplan?.site_id ? String(workOrder.floorplan.site_id) : '')
  );
  const [floorplans, setFloorplans] = useState([]);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState(
    workOrder.floorplan_id ? String(workOrder.floorplan_id) : ''
  );
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState(
    (workOrder.rooms || []).map(r => r.id)
  );
  const [availableEquipment, setAvailableEquipment] = useState([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState(
    (workOrder.equipment || []).map(e => e.id)
  );
  const [locationDetails, setLocationDetails] = useState(workOrder.location_details || '');

  // Assignees & Schedule
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState(
    (workOrder.assignees || []).map(u => u.id)
  );
  const [startDate, setStartDate] = useState(
    workOrder.start_date
      ? (workOrder.start_date.includes('T') ? workOrder.start_date.slice(0, 16) : workOrder.start_date)
      : (isTriage ? getLocalDateTimeString() : '')
  );
  const [dueDate, setDueDate] = useState(
    workOrder.due_date ? (workOrder.due_date.includes('T') ? workOrder.due_date.slice(0, 16) : workOrder.due_date) : ''
  );
  const [estimatedHours, setEstimatedHours] = useState(
    workOrder.estimated_hours !== undefined && workOrder.estimated_hours !== null
      ? String(workOrder.estimated_hours)
      : '1.0'
  );

  // Trades list
  const [availableTrades, setAvailableTrades] = useState([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dispatchNote, setDispatchNote] = useState('');

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  // Load Initial Options (Sites, Assignable Users, Trades)
  useEffect(() => {
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
  }, []);

  // Load Floorplans when Site changes
  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    getFloorplans(selectedSiteId)
      .then(res => setFloorplans(res.data || []))
      .catch(err => console.error("Error loading floorplans:", err));
  }, [selectedSiteId]);

  // Load Rooms & Equipment
  useEffect(() => {
    if (selectedFloorplanId) {
      getRooms(selectedFloorplanId)
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getEquipment(selectedFloorplanId)
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    } else if (selectedSiteId) {
      const siteNum = parseInt(selectedSiteId, 10);
      getAllRooms()
        .then(res => setAvailableRooms((res.data || []).filter(r => r.site_id === siteNum)))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment((res.data || []).filter(e => e.site_id === siteNum)))
        .catch(() => setAvailableEquipment([]));
    } else {
      getAllRooms()
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    }
  }, [selectedFloorplanId, selectedSiteId]);

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

  // Task Template Linking
  const handleSelectTask = (task) => {
    setLinkedTask(task);
    if (!title.trim() || title === workOrder.title) {
      setTitle(task.description || '');
    }
    if (!description.trim() || description === initialDescription) {
      setDescription(stripRepeatedWorkOrderTitle(
        task.description,
        task.pm_task_sheet || task.description || '',
      ));
    }
    if (task.category) setCategory(task.category);
    if (task.trade) setTrade(task.trade);
    if (task.estimated_hours) setEstimatedHours(String(task.estimated_hours));
    if (Array.isArray(task.checklist_items) && task.checklist_items.length > 0) {
      // If no existing checklist items or user had none, set from task
      if (checklistItems.length === 0) {
        setChecklistItems(task.checklist_items);
      } else {
        // Append new steps that are not duplicates
        const existingTexts = new Set(checklistItems.map(i => typeof i === 'string' ? i : (i.task || i.text)));
        const newItems = task.checklist_items.filter(i => {
          const txt = typeof i === 'string' ? i : (i.task || i.text);
          return !existingTexts.has(txt);
        });
        setChecklistItems(prev => [...prev, ...newItems]);
      }
    }
  };

  const handleUnlinkTask = () => {
    setLinkedTask(null);
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

    if (!selectedType.task_sheet_id) {
      return;
    }

    try {
      const taskSheet = (await getTask(selectedType.task_sheet_id)).data;
      setLinkedTask(taskSheet);
      if (checklistItems.length === 0 && Array.isArray(taskSheet.checklist_items)) {
        setChecklistItems(taskSheet.checklist_items);
      }
    } catch (err) {
      console.error('Error loading linked task sheet:', err);
    }
  };

  // Checklist management
  const handleAddChecklistStep = () => {
    if (!newStepText.trim()) return;
    const newItem = {
      id: crypto.randomUUID ? crypto.randomUUID() : `step-${Date.now()}`,
      task: newStepText.trim(),
      type: newStepType,
      required: true,
      completed: false
    };
    if (newStepType === 'reading' && newStepUnit.trim()) {
      newItem.unit = newStepUnit.trim();
    }
    setChecklistItems(prev => [...prev, newItem]);
    setNewStepText('');
    setNewStepUnit('');
  };

  const handleRemoveChecklistStep = (index) => {
    setChecklistItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleToggleStepCompleted = (index) => {
    setChecklistItems(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      if (typeof item === 'string') {
        return { id: `step-${idx}`, task: item, completed: true };
      }
      return { ...item, completed: !item.completed };
    }));
  };

  // Submit Handler
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
    if (selectedEquipmentIds.length > 0) {
      locType = selectedEquipmentIds.length === 1 ? 'equipment' : 'multi';
    } else if (selectedRoomIds.length > 0) {
      locType = selectedRoomIds.length === 1 ? 'room' : 'multi';
    } else if (selectedFloorplanId) {
      locType = 'pin';
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      trade: trade.trim() || null,
      priority,
      status: isTriage && status === 'approve'
        ? (selectedAssigneeIds.length > 0 ? 'assigned' : 'unassigned')
        : status,
      location_type: locType,
      site_id: selectedSiteId ? parseInt(selectedSiteId, 10) : null,
      floorplan_id: selectedFloorplanId ? parseInt(selectedFloorplanId, 10) : null,
      room_ids: selectedRoomIds,
      equipment_ids: selectedEquipmentIds,
      location_details: locationDetails.trim() || null,
      assigned_user_ids: selectedAssigneeIds,
      start_date: startDate ? new Date(startDate).toISOString() : null,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      estimated_hours: parseFloat(estimatedHours) || 0.0,
      task_type_id: taskTypeId ? Number(taskTypeId) : null,
      task_id: linkedTask ? linkedTask.id : null,
      checklist_items: checklistItems || []
    };

    try {
      const res = await updateWorkOrder(workOrder.id, payload);
      if (isTriage && dispatchNote.trim()) {
        try {
          await addWorkOrderComment(workOrder.id, {
            comment: `[${isPendingTriage ? 'Triage' : 'Dispatch'} Note]: ${dispatchNote.trim()}`,
            author_name: effectiveUser?.full_name || effectiveUser?.username || 'Triage Officer',
          });
        } catch (commentError) {
          console.error('Error posting dispatch comment:', commentError);
        }
      }
      if (onUpdated) onUpdated(res.data);
      onClose();
    } catch (err) {
      console.error('Error updating work order:', err);
      setError(getErrorMessage(err, 'Failed to save work order changes.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const siteObj = sites.find(s => String(s.id) === String(selectedSiteId));
  const floorObj = floorplans.find(f => String(f.id) === String(selectedFloorplanId));

  const roomPlaceholder = floorObj
    ? `Search rooms on ${floorObj.name}...`
    : siteObj
      ? `Search rooms in ${siteObj.name}...`
      : 'Search all rooms across buildings...';

  const equipPlaceholder = floorObj
    ? `Search equipment on ${floorObj.name}...`
    : siteObj
      ? `Search equipment in ${siteObj.name}...`
      : 'Search all equipment across buildings...';

  // Ensure current trade is in list if not empty
  const tradesDisplayList = [...availableTrades];
  if (trade && !tradesDisplayList.includes(trade)) {
    tradesDisplayList.unshift(trade);
  }

  const handleFormKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  };

  const modalTitle = isTriage
    ? (isPendingTriage ? 'Triage & dispatch request' : 'Edit dispatch & schedule')
    : 'Edit work order';
  const modalSubtitle = isTriage
    ? 'Review the request, confirm its scope and linked assets, then dispatch it.'
    : 'Update the scope, location, assignment, schedule, and checklist.';

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark wo-edit-overlay" onClick={onClose}>
      <div
        className="modal-card modal-xl glass-panel wo-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-card-header wo-edit-modal-header">
          <div className="wo-edit-header-title">
            <div className="icon-box-primary" aria-hidden="true">
              {isTriage ? <ShieldAlert size={18} /> : <Wrench size={18} />}
            </div>
            <div>
              <div className="wo-edit-title-row">
                <h2 id={modalTitleId}>{modalTitle}</h2>
                {workOrder.order_number && <span className="wo-edit-order-number">{workOrder.order_number}</span>}
              </div>
              <p>{modalSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-sm"
            aria-label="Close work order editor"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="wo-edit-form-shell">
          <div className="modal-card-body wo-edit-form-body">
          {error && (
            <div className="wo-edit-error" role="alert">
              <ShieldAlert size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {isTriage && (
            <section className="wo-edit-request-summary" aria-labelledby="wo-edit-request-heading">
              <span id="wo-edit-request-heading" className="wo-edit-eyebrow">Submitted request</span>
              <strong>{workOrder.title}</strong>
              {workOrder.description && <p>{workOrder.description}</p>}
              <div className="wo-edit-request-meta">
                <span><strong>Requester:</strong> {workOrder.requester_name || 'Anonymous'}</span>
                {workOrder.requester_email && (
                  <a className="triage-request-contact" href={`mailto:${workOrder.requester_email}`}>
                    <strong>Email:</strong> {workOrder.requester_email}
                  </a>
                )}
                {workOrder.requester_phone && (
                  <a className="triage-request-contact" href={`tel:${workOrder.requester_phone}`}>
                    <strong>Phone:</strong> {workOrder.requester_phone}
                  </a>
                )}
              </div>
            </section>
          )}

          <div className="wo-edit-primary-fields">
          <div className="wo-edit-field">
            <label htmlFor="wo-edit-title"><span>Work order title</span><span className="wo-edit-label-required">Required</span></label>
            <input
              ref={titleInputRef}
              id="wo-edit-title"
              type="text"
              className="input-field wo-edit-title-input"
              placeholder="e.g. Replace AHU-1 air filter"
              value={title}
              onChange={e => setTitle(e.target.value)}
              aria-invalid={error === 'Title is required'}
              required
            />
          </div>

          <div className="wo-edit-field">
            <label htmlFor="wo-edit-description"><span>Description</span><span className="wo-edit-label-meta">Keep the scope and access notes together</span></label>
            <textarea
              id="wo-edit-description"
              className="input-field wo-edit-description"
              rows={3}
              placeholder="Describe the scope, instructions, access notes, or required parts..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="wo-edit-metadata-grid">
            <div className="wo-edit-field">
              <label htmlFor="wo-edit-category">Category</label>
              <select
                id="wo-edit-category"
                className="input-field"
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="wo-edit-field">
              <label htmlFor="wo-edit-task-type"><span>Task type</span><span className="wo-edit-label-meta">Optional</span></label>
              <select
                id="wo-edit-task-type"
                className="input-field"
                value={taskTypeId}
                onChange={handleTaskTypeChange}
                disabled={taskTypesLoading}
              >
                {taskTypesLoading ? (
                  <option value={taskTypeId}>{workOrder.task_type_name || 'Loading task types…'}</option>
                ) : (
                  <>
                    <option value="">No task type</option>
                    {availableTaskTypes.map(item => (
                      <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="wo-edit-field">
              <label htmlFor="wo-edit-priority">Priority</label>
              <select
                id="wo-edit-priority"
                className="input-field"
                value={priority}
                onChange={e => setPriority(e.target.value)}
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="wo-edit-field">
              <label htmlFor="wo-edit-status">Status</label>
              <select
                id="wo-edit-status"
                className="input-field"
                value={status}
                onChange={e => setStatus(e.target.value)}
              >
                {(isTriage ? TRIAGE_STATUS_OPTIONS : STATUS_OPTIONS).map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="wo-edit-field">
              <label htmlFor="wo-edit-trade"><span>Assigned trade</span><span className="wo-edit-label-meta">Optional</span></label>
              <select
                id="wo-edit-trade"
                className="input-field"
                value={trade}
                onChange={e => setTrade(e.target.value)}
              >
                <option value="">None / General</option>
                {tradesDisplayList.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="wo-edit-field">
            <span className="wo-edit-field-label">Linked task sheet</span>
            <TaskTemplateLinkSelector
              linkedTask={linkedTask}
              checklistCount={checklistItems.length}
              onOpen={() => setIsTaskSelectOpen(true)}
              onUnlink={handleUnlinkTask}
            />
          </div>
          </div>

          <AssetsOwnershipSection
            headingId="wo-edit-assets-heading"
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
            <div className="wo-edit-field">
              <label htmlFor="wo-edit-location-details"><span>Location notes</span><span className="wo-edit-label-meta">Optional</span></label>
              <input
                id="wo-edit-location-details"
                type="text"
                className="input-field"
                placeholder="Access instructions, landmarks, or key requirements..."
                value={locationDetails}
                onChange={e => setLocationDetails(e.target.value)}
              />
            </div>
          </AssetsOwnershipSection>

          <section className="wo-edit-section" aria-labelledby="wo-edit-assignment-heading">
            <div className="wo-edit-section-heading">
              <div className="wo-edit-section-icon" aria-hidden="true"><User size={15} /></div>
              <div>
                <h3 id="wo-edit-assignment-heading">Assignment &amp; Schedule</h3>
                <p>Set ownership and timing without leaving the editor.</p>
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
              disabled={!canAssign}
              disabledMessage="You do not have permission to assign technicians"
            />

            <div className="wo-edit-schedule-grid">
              <div className="wo-edit-field">
                <label htmlFor="wo-edit-start"><span>Start</span><span className="wo-edit-label-meta">Optional</span></label>
                <input
                  id="wo-edit-start"
                  type="datetime-local"
                  className="input-field"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>

              <div className="wo-edit-field">
                <label htmlFor="wo-edit-due"><span>Due</span><span className="wo-edit-label-meta">Optional</span></label>
                <input
                  id="wo-edit-due"
                  type="datetime-local"
                  className="input-field"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>

              <div className="wo-edit-field">
                <label htmlFor="wo-edit-hours">Estimated hours</label>
                <input
                  id="wo-edit-hours"
                  type="number"
                  step="any"
                  min="0"
                  className="input-field"
                  value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="wo-edit-section" aria-labelledby="wo-edit-checklist-heading">
            <div className="wo-edit-section-heading">
              <div className="wo-edit-section-icon" aria-hidden="true"><CheckSquare size={15} /></div>
              <div>
                <h3 id="wo-edit-checklist-heading">Checklist</h3>
                <p>{checklistItems.length ? `${checklistItems.length} step${checklistItems.length === 1 ? '' : 's'} in this work order.` : 'Add the steps needed to complete the work.'}</p>
              </div>
            </div>

            {checklistItems.length > 0 && (
              <div className="wo-edit-checklist-list">
                {checklistItems.map((item, idx) => {
                  const stepText = typeof item === 'string' ? item : (item.task || item.text || `Step ${idx + 1}`);
                  const isChecked = typeof item === 'object' && Boolean(item.completed);
                  const isReading = typeof item === 'object' && item.type === 'reading';

                  return (
                    <div key={item.id || idx} className={`wo-edit-checklist-row${isChecked ? ' is-complete' : ''}`}>
                      <div className="wo-edit-checklist-content">
                        <button
                          type="button"
                          onClick={() => handleToggleStepCompleted(idx)}
                          className="wo-edit-step-toggle"
                          aria-label={`${isChecked ? 'Mark pending' : 'Mark completed'}: ${stepText}`}
                          aria-pressed={isChecked}
                          title={isChecked ? 'Mark pending' : 'Mark completed'}
                        >
                          {isChecked && <Check size={14} />}
                        </button>
                        <span className="wo-edit-step-text">
                          {stepText}
                          {isReading && item.unit && <span className="badge badge-secondary wo-edit-step-unit">[{item.unit}]</span>}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveChecklistStep(idx)}
                        className="btn btn-ghost btn-icon-xs text-danger"
                        aria-label={`Remove checklist step: ${stepText}`}
                        title="Remove step"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="wo-edit-checklist-add">
              <input
                type="text"
                className="input-field"
                aria-label="New checklist step"
                placeholder="Add new checklist step..."
                value={newStepText}
                onChange={e => setNewStepText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddChecklistStep();
                  }
                }}
              />
              <select
                className="input-field wo-edit-checklist-type"
                aria-label="Checklist step type"
                value={newStepType}
                onChange={e => setNewStepType(e.target.value)}
              >
                <option value="checkbox">Checkbox</option>
                <option value="reading">Measurement</option>
              </select>
              {newStepType === 'reading' && (
                <input
                  type="text"
                  className="input-field wo-edit-checklist-unit"
                  aria-label="Measurement unit"
                  placeholder="Unit (PSI)"
                  value={newStepUnit}
                  onChange={e => setNewStepUnit(e.target.value)}
                />
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAddChecklistStep}
                disabled={!newStepText.trim()}
              >
                <Plus size={14} />
                <span>Add step</span>
              </button>
            </div>
          </section>

          {isTriage && (
            <div className="wo-edit-field wo-edit-dispatch-note">
              <label htmlFor="wo-edit-dispatch-note"><span>Internal triage / dispatch note</span><span className="wo-edit-label-meta">Optional</span></label>
              <textarea
                id="wo-edit-dispatch-note"
                className="input-field wo-edit-description"
                rows={3}
                value={dispatchNote}
                onChange={e => setDispatchNote(e.target.value)}
                placeholder="Document the dispatch decision, access notes, or instructions for the assigned technicians..."
              />
            </div>
          )}

          </div>

          <div className="modal-card-footer wo-edit-modal-footer">
            <span className="wo-edit-footer-note">{isTriage ? 'Review the dispatch decision before saving.' : 'Changes apply to this work order.'}</span>
            <div className="wo-edit-footer-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`btn btn-sm gap-xs ${isTriage && status === 'cancelled' ? 'btn-danger' : 'btn-primary'}`}
            >
              <Save size={14} />
              <span>{isSubmitting
                ? (isTriage ? 'Saving dispatch...' : 'Saving changes...')
                : (isTriage
                  ? (status === 'cancelled'
                    ? 'Reject Request'
                    : status === 'on_hold'
                      ? 'Approve & Put On Hold'
                      : status === 'in_progress'
                        ? 'Approve & Start Work'
                        : (selectedAssigneeIds.length > 0 ? 'Approve & Dispatch' : 'Approve Request'))
                  : 'Save changes')}</span>
            </button>
            </div>
          </div>
        </form>

        {/* Task Selection Sub-Modal */}
        {isTaskSelectOpen && (
          <TaskSelectModal
            isOpen={isTaskSelectOpen}
            onClose={() => setIsTaskSelectOpen(false)}
            onSelectTask={handleSelectTask}
            title="Select task sheet to link"
            subtitle="Link a standard task sheet to populate instructions and checklist items."
            actionButtonLabel="Link task sheet"
            currentLinkedTaskId={linkedTask?.id}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
