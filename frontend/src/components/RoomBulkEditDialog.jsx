import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getErrorMessage } from '../api';

export default function RoomBulkEditDialog({ count, onSave, onClose, returnFocus }) {
  const dialogRef = useRef(null);
  const descriptionRef = useRef(null);
  const [description, setDescription] = useState('');
  const [clearDescriptions, setClearDescriptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const canSave = clearDescriptions || description.trim().length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = returnFocus.current;
    dialog.showModal();
    descriptionRef.current?.focus();
    return () => {
      dialog.close();
      trigger?.focus();
    };
  }, [returnFocus]);

  const submit = async event => {
    event.preventDefault();
    if (!canSave || saving) return;
    if (!clearDescriptions && /[*?]/.test(description)) {
      setInvalid(true);
      setError('Description cannot contain * or ?.');
      requestAnimationFrame(() => descriptionRef.current?.focus());
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(clearDescriptions ? '' : description);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not update the rooms. Try again.'));
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="room-bulk-dialog modal-card modal-md glass-panel"
      aria-modal="true" aria-labelledby="room-bulk-title" onCancel={event => {
        event.preventDefault();
        if (!saving) onClose();
      }}>
      <div className="modal-card-header">
        <h2 id="room-bulk-title">Bulk edit {count.toLocaleString()} {count === 1 ? 'room' : 'rooms'}</h2>
        <button type="button" className="btn btn-secondary" aria-label="Close bulk edit" title="Close bulk edit"
          onClick={onClose} disabled={saving}><X size={18} /></button>
      </div>
      <form id="room-bulk-form" className="modal-card-body" onSubmit={submit}>
        <div className="room-bulk-field">
          <label htmlFor="room-bulk-description">Description</label>
          <textarea ref={descriptionRef} id="room-bulk-description" name="description" className="input-field"
            rows={3} value={clearDescriptions ? '' : description} disabled={clearDescriptions} readOnly={saving}
            aria-invalid={invalid || undefined} aria-describedby={invalid ? 'room-bulk-error' : undefined} onChange={event => {
              setDescription(event.target.value);
              setInvalid(false);
              setError('');
            }} />
        </div>
        <label className="room-bulk-checkbox">
          <input type="checkbox" checked={clearDescriptions} disabled={saving} onChange={event => {
            setClearDescriptions(event.target.checked);
            setInvalid(false);
            setError('');
          }} />
          Clear descriptions
        </label>
        {error && <p id="room-bulk-error" className="text-danger m-0" role="alert">{error}</p>}
      </form>
      <div className="modal-card-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" form="room-bulk-form" disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Save descriptions'}
        </button>
      </div>
    </dialog>
  );
}
