import {
  DoorOpen, Map as MapIcon, Building,
  Check, X, Pencil, ExternalLink, Trash2,
  MapPin, MapPinOff, ClipboardList, Calendar
} from 'lucide-react';

export default function RoomCard({
  room,
  isEditing = false,
  editForm,
  setEditForm,
  isEditor = false,
  startEditRoom,
  saveEditRoom,
  setEditingRoomId,
  handleDeleteRoom,
  goToMap,
  goToPlaceRoom,
  onViewWorkOrders,
  onOpenPMSchedules
}) {
  if (!room) return null;

  const isUnlocated = room.x_coordinate == null || room.y_coordinate == null;

  return (
    <div className={`table-mobile-card glass-panel ${isEditing ? 'editing-card' : ''}`}>
      {/* 1. Header: Name & Status / Edit Input */}
      <div className="table-mobile-card-top">
        {isEditing ? (
          <div className="flex-1 mr-sm">
            <input
              className="inline-edit-input"
              value={editForm?.name || ''}
              onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="Room Name"
              autoFocus
            />
          </div>
        ) : (
          <div className="items-center gap-sm flex-1 min-w-0">
            <div className="avatar-circle-xs bg-primary-subtle text-primary">
              <DoorOpen size={13} color="#3b82f6" />
            </div>
            <span className="table-mobile-card-title text-truncate">
              {room.name}
            </span>
          </div>
        )}

        {!isEditing && (
          <div>
            {isUnlocated ? (
              <span className="status-badge badge-warning">
                <MapPinOff size={11} />
                <span>Unlocated</span>
              </span>
            ) : (
              <span className="status-badge badge-success">
                <MapPin size={11} />
                <span>Located</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. Body: Description (or Description Input) */}
      <div className="table-mobile-card-body">
        {isEditing ? (
          <input
            className="inline-edit-input"
            value={editForm?.description || ''}
            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
            placeholder="Room Description"
          />
        ) : (
          room.description && (
            <div className="text-sm text-secondary line-clamp-2">
              {room.description}
            </div>
          )
        )}

        {/* Tags */}
        <div className="table-mobile-card-tags">
          <span className="floorplan-tag">
            <MapIcon size={12} /> {room.floorplan_name || `Floorplan #${room.floorplan_id}`}
          </span>
          {room.site_name && (
            <span className="site-tag">
              <Building size={12} /> {room.site_name}
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
              onClick={() => setEditingRoomId(null)}
            >
              <X size={13} className="flex-shrink-0" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-card-action"
              onClick={() => saveEditRoom(room.id)}
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
                onClick={() => startEditRoom(room)}
                title="Edit Room"
              >
                <Pencil size={13} className="flex-shrink-0" />
                <span className="btn-label-edit">Edit</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => onViewWorkOrders && onViewWorkOrders(room, 'room')}
              title="View Work Orders"
            >
              <ClipboardList size={13} className="flex-shrink-0" />
              <span>Work Orders</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => onOpenPMSchedules && onOpenPMSchedules(room, 'room')}
              title="View PM Schedules"
            >
              <Calendar size={13} className="flex-shrink-0" />
              <span>PM</span>
            </button>

            <div className="items-center gap-xs flex-nowrap ml-auto">
              {isUnlocated && isEditor ? (
                <button
                  type="button"
                  className="btn btn-warning-solid btn-card-action"
                  onClick={() => goToPlaceRoom ? goToPlaceRoom(room) : goToMap(room)}
                  title="Click to place on floorplan"
                >
                  <MapPin size={13} className="flex-shrink-0" />
                  <span>Place on Map</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-card-action"
                  onClick={() => goToMap(room)}
                  title="Go to Map"
                >
                  <ExternalLink size={13} className="flex-shrink-0" />
                  <span>Map</span>
                </button>
              )}

              {isEditor && (
                <button
                  type="button"
                  className="btn btn-ghost btn-card-action text-danger btn-icon"
                  onClick={() => handleDeleteRoom(room.id)}
                  title="Delete Room"
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
