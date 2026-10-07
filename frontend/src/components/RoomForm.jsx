import { useRef } from 'react';
import { MapPin, Trash2, Check } from 'lucide-react';


export function RoomForm({
  editingRoom,
  newPinCoord,
  isEditor,
  isMobile,
  formError,
  setFormError,
  onSubmit,
  onCancel,
  onRelocate,
  onDelete
}) {
  const roomNameRef = useRef(null);
  const roomDescRef = useRef(null);

  // If newPinCoord or editingRoom changes, reset refs or let standard inputs render
  const isEditing = !!editingRoom;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (e.currentTarget !== e.target) return;
    const form = e.currentTarget;
    const name = isEditing ? (form.elements?.name?.value || '') : (roomNameRef.current?.value || '');
    const description = isEditing ? (form.elements?.description?.value || '') : (roomDescRef.current?.value || '');

    if (name.includes('*') || name.includes('?') || description.includes('*') || description.includes('?')) {
      setFormError("Name and description cannot contain * or ?");
      return;
    }

    onSubmit({
      name,
      description
    });
  };

  const actionButtons = (
    <div className={`form-actions-row flex items-center justify-between gap-xs ${isMobile ? 'mobile' : ''}`}>
      {isEditing ? (
        <>
          {isEditor && (
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm gap-xs"
                onClick={onDelete}
                title="Delete Room"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
              <div className="flex items-center gap-xs">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm gap-xs"
                  onClick={onRelocate}
                  title="Move Room Pin Location"
                >
                  <MapPin size={14} />
                  <span>Relocate</span>
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                >
                  <Check size={14} />
                  <span>Save</span>
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {isEditor && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onCancel}
              >
                Reposition
              </button>
              <button type="submit" className="btn btn-primary btn-sm ml-auto gap-xs">
                <Check size={14} />
                <span>Save Room</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="room-form-container">
      <form onSubmit={handleSubmit}>
        {isMobile && actionButtons}

        {!isEditing && (
          <h4 className="text-base font-bold mb-lg text-accent">
            Add Room at ({Math.round(newPinCoord?.x || 0)}, {Math.round(newPinCoord?.y || 0)})
          </h4>
        )}

        <div className="input-group">
          <label>Room Name</label>
          {isEditing ? (
            <input
              name="name"
              defaultValue={editingRoom.name}
              className={`input-field ${!isEditor ? 'input-readonly-plain' : ''} ${formError ? 'input-error' : ''}`}
              required
              readOnly={!isEditor}
              onChange={() => setFormError('')}
            />
          ) : (
            <input
              ref={roomNameRef}
              className={`input-field ${formError ? 'input-error' : ''}`}
              required
              onChange={() => setFormError('')}
            />
          )}
          {formError && <span className="text-danger text-sm mt-xs">{formError}</span>}
        </div>

        <div className="input-group">
          <label>Description</label>
          {isEditing ? (
            <input
              name="description"
              defaultValue={editingRoom.description}
              className={`input-field ${!isEditor ? 'input-readonly-plain' : ''}`}
              readOnly={!isEditor}
            />
          ) : (
            <input ref={roomDescRef} className="input-field" />
          )}
        </div>

        {!isMobile && actionButtons}
      </form>


    </div>
  );
}
