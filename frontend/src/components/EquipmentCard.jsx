import {
  Map as MapIcon, Building,
  Check, X, Pencil, ExternalLink, Trash2,
  Wrench, ClipboardList, Calendar
} from 'lucide-react';
import { COLORS } from '../mapConstants';

export default function EquipmentCard({
  equip,
  isEditing = false,
  editForm,
  setEditForm,
  isEditor = false,
  startEditEquip,
  saveEditEquip,
  setEditingEquipId,
  handleDeleteEquip,
  goToMap,
  selectedEquipIds = [],
  toggleEquipSelection,
  onViewWorkOrders,
  onOpenPMSchedules
}) {
  if (!equip) return null;

  const isSelected = selectedEquipIds.includes(equip.id);

  return (
    <div
      className={`table-mobile-card glass-panel ${isEditing ? 'editing-card' : ''} ${isSelected ? 'selected-card' : ''}`}
    >
      {/* 1. Header: Selection, Swatch, Name & Top Status */}
      <div className="table-mobile-card-top">
        <div className="items-center gap-sm flex-1 min-w-0">
          {isEditor && !isEditing && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleEquipSelection && toggleEquipSelection(equip.id)}
              className="mr-xs pointer"
            />
          )}

          {!isEditing && (
            <span
              className="color-swatch flex-shrink-0"
              style={{ backgroundColor: equip.color || '#10b981' }}
            />
          )}

          {isEditing ? (
            <div className="flex-1 mr-xs">
              <input
                className="inline-edit-input"
                value={editForm?.name || ''}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Equipment Name"
                autoFocus
              />
            </div>
          ) : (
            <span className="table-mobile-card-title text-truncate">
              {equip.name}
            </span>
          )}
        </div>
      </div>

      {/* 2. Body: Description, Tools, Swatch picker if editing, Tags */}
      <div className="table-mobile-card-body">
        {isEditing ? (
          <>
            <input
              className="inline-edit-input"
              value={editForm?.description || ''}
              onChange={e => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="Description"
            />
            <input
              className="inline-edit-input"
              value={editForm?.tools_required || ''}
              onChange={e => setEditForm({ ...editForm, tools_required: e.target.value })}
              placeholder="Tools Required"
            />
            <div className="items-center gap-xs mt-xs flex-wrap">
              <span className="text-xs text-muted mr-xs">Color:</span>
              <div className="color-picker-inline">
                {COLORS.map(c => (
                  <div
                    key={c}
                    className={`swatch-option ${editForm?.color === c ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditForm({ ...editForm, color: c })}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {equip.description && (
              <div className="text-sm text-secondary line-clamp-2">
                {equip.description}
              </div>
            )}
            {equip.tools_required && (
              <div className="items-center gap-xs text-xs text-muted">
                <Wrench size={12} color="var(--text-secondary)" />
                <span>Tools: <strong className="text-primary">{equip.tools_required}</strong></span>
              </div>
            )}
          </>
        )}

        {/* Tags */}
        <div className="table-mobile-card-tags">
          {equip.floorplan_name && (
            <span className="floorplan-tag">
              <MapIcon size={12} /> {equip.floorplan_name}
            </span>
          )}
          {equip.site_name && (
            <span className="site-tag">
              <Building size={12} /> {equip.site_name}
            </span>
          )}
        </div>
      </div>

      {/* 3. Footer: Actions */}
      <div className="table-mobile-card-footer">
        {isEditing ? (
          <div className="items-center gap-xs ml-auto flex-nowrap">
            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => setEditingEquipId(null)}
            >
              <X size={13} className="flex-shrink-0" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-card-action"
              onClick={() => saveEditEquip(equip.id)}
            >
              <Check size={13} className="flex-shrink-0" />
              <span>Save</span>
            </button>
          </div>
        ) : (
          <div className="card-actions-wrapper">
            {isEditor && (
              <button
                type="button"
                className="btn btn-secondary btn-card-action"
                onClick={() => startEditEquip(equip)}
                title="Edit Equipment"
              >
                <Pencil size={13} className="flex-shrink-0" />
                <span className="btn-label-edit">Edit</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => onViewWorkOrders && onViewWorkOrders(equip, 'equipment')}
              title="View Work Orders"
            >
              <ClipboardList size={13} className="flex-shrink-0" />
              <span>Work Orders</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => onOpenPMSchedules && onOpenPMSchedules(equip, 'equipment')}
              title="View PM Schedules"
            >
              <Calendar size={13} className="flex-shrink-0" />
              <span>PM</span>
            </button>

            <div className="items-center gap-xs flex-nowrap ml-auto">
              <button
                type="button"
                className="btn btn-ghost btn-card-action"
                onClick={() => goToMap(equip)}
                title="Go to Map"
              >
                <ExternalLink size={13} className="flex-shrink-0" />
                <span>Map</span>
              </button>

              {isEditor && (
                <button
                  type="button"
                  className="btn btn-ghost btn-card-action text-danger btn-icon"
                  onClick={() => handleDeleteEquip(equip.id)}
                  title="Delete Equipment"
                >
                  <Trash2 size={13} className="flex-shrink-0" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
