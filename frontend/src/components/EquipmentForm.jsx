import { useRef } from 'react';
import { MapPin, Trash2, Check } from 'lucide-react';
import { COLORS } from '../mapConstants';


export function EquipmentForm({
  editingEquipment,
  newPinCoord,
  isEditor,
  isMobile,
  formError,
  setFormError,
  equipColor,
  setEquipColor,
  onSubmit,
  onCancel,
  onRelocate,
  onDelete
}) {
  const equipNameRef = useRef(null);
  const equipDescRef = useRef(null);
  const isEditing = !!editingEquipment;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (e.currentTarget !== e.target) return;
    if (!equipColor) {
      setFormError("Please select a color.");
      return;
    }

    const form = e.currentTarget;
    const name = isEditing ? (form.elements?.name?.value || '') : (equipNameRef.current?.value || '');
    const description = isEditing ? (form.elements?.description?.value || '') : (equipDescRef.current?.value || '');

    if (name.includes('*') || name.includes('?') || description.includes('*') || description.includes('?')) {
      setFormError("Name and description cannot contain * or ?");
      return;
    }

    const toolsRequired = form.elements?.tools_required?.value || '';

    onSubmit({
      name,
      description,
      tools_required: toolsRequired,
      color: equipColor
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
                title="Delete Equipment"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
              <div className="flex items-center gap-xs">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm gap-xs"
                  onClick={onRelocate}
                  title="Move Pin Location"
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
                <span>Save Pin</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="equipment-form-container">
      <form onSubmit={handleSubmit}>
        {isMobile && actionButtons}

        {!isEditing && (
          <h4 className="text-base font-bold mb-lg text-success">
            Add Equipment at ({Math.round(newPinCoord?.x || 0)}, {Math.round(newPinCoord?.y || 0)})
          </h4>
        )}

        <div className="input-group">
          <label>Equipment Name</label>
          {isEditing ? (
            <input
              name="name"
              defaultValue={editingEquipment.name}
              className={`input-field ${!isEditor ? 'input-readonly-plain' : ''} ${formError ? 'input-error' : ''}`}
              required
              readOnly={!isEditor}
              onChange={() => setFormError('')}
            />
          ) : (
            <input
              ref={equipNameRef}
              className={`input-field ${formError ? 'input-error' : ''}`}
              required
              onChange={() => setFormError('')}
            />
          )}
          {formError && <span className="text-danger text-sm mt-xs">{formError}</span>}
        </div>

        {(editingEquipment?.description || isEditor) && (
          <div className="input-group">
            <label>Description</label>
            {isEditing ? (
              <input
                name="description"
                defaultValue={editingEquipment.description}
                className={`input-field ${!isEditor ? 'input-readonly-plain' : ''}`}
                readOnly={!isEditor}
              />
            ) : (
              <input ref={equipDescRef} className="input-field" />
            )}
          </div>
        )}
        {(editingEquipment?.tools_required || isEditor) && (
          <div className="input-group">
            <label>Tools Required</label>
            {isEditing ? (
              <input
                name="tools_required"
                defaultValue={editingEquipment.tools_required}
                className={`input-field ${!isEditor ? 'input-readonly-plain' : ''}`}
                placeholder={isEditor ? "e.g. Screwdriver, Drill" : "None"}
                readOnly={!isEditor}
              />
            ) : (
              <input name="tools_required" className="input-field" placeholder="e.g. Screwdriver, Drill" />
            )}
          </div>
        )}
        {isEditor && (
          <div className="input-group">
            <label>Pin Color</label>
            <div className="flex-row flex-wrap gap-sm mt-xs">
              {COLORS.map(c => (
                <div
                  key={c}
                  onClick={() => setEquipColor(c)}
                  className="color-swatch-item"
                  style={{
                    backgroundColor: c,
                    border: equipColor === c ? '3px solid white' : '2px solid rgba(255,255,255,0.1)',
                    boxShadow: equipColor === c ? `0 0 0 2px ${c}` : 'none'
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {!isMobile && actionButtons}
      </form>


    </div>
  );
}
