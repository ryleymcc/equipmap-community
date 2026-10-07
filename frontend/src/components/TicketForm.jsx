import { useState } from 'react';
import { Trash2, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { getErrorMessage } from '../api';

export function TicketForm({
  editingTicket,
  newPinCoord,
  formError,
  setFormError,
  onSubmit,
  onCancel,
  onRelocate,
  onDelete
}) {
  const { user } = useAuth();
  const [prevTicketId, setPrevTicketId] = useState(editingTicket?.id);
  const [title, setTitle] = useState(editingTicket ? editingTicket.title : '');
  const [description, setDescription] = useState(editingTicket ? editingTicket.description : '');
  const [status, setStatus] = useState(editingTicket ? editingTicket.status : 'open');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (editingTicket && editingTicket.id !== prevTicketId) {
    setPrevTicketId(editingTicket.id);
    setTitle(editingTicket.title);
    setDescription(editingTicket.description);
    setStatus(editingTicket.status);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Please enter a title for the issue.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const data = {
        title: title.trim(),
        description: description.trim(),
        status
      };

      if (editingTicket) {
        await onSubmit(editingTicket.id, data);
      } else {
        await onSubmit({
          ...data,
          x_coordinate: newPinCoord.x,
          y_coordinate: newPinCoord.y
        });
      }
    } catch (err) {
      setFormError(getErrorMessage(err, 'An error occurred. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCreator = Boolean(editingTicket && user && editingTicket.created_by_id === user.id);
  const isEditor = Boolean(user && (user.role === 'admin' || user.role === 'editor' || user.can_manage_items !== false));
  const canModify = Boolean(user && (!editingTicket || isCreator || isEditor));
  const canDelete = Boolean(user && editingTicket && (isCreator || isEditor));

  return (
    <form className="item-form" onSubmit={handleSubmit}>
      {formError && (
        <div className="error-alert mb-lg">
          <AlertCircle size={18} />
          <span>{formError}</span>
        </div>
      )}

      <div className="input-group">
        <label>Issue Title</label>
        <input
          type="text"
          className={`input-field ${!canModify ? 'input-readonly-plain' : ''}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Broken Light, Water Leak"
          readOnly={!canModify}
          disabled={isSubmitting}
          autoFocus={!editingTicket && canModify}
        />
      </div>

      <div className="input-group">
        <label>Description</label>
        <textarea
          className={`input-field resize-vertical ${!canModify ? 'input-readonly-plain' : ''}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the issue in more detail..."
          rows={3}
          readOnly={!canModify}
          disabled={isSubmitting}
        />
      </div>

      {editingTicket && canModify && (
        <div className="input-group">
          <label>Actions</label>
          <button
            type="button"
            className="btn btn-secondary btn-full gap-sm"
            onClick={onRelocate}
            disabled={isSubmitting}
          >
            <MapPin size={18} /> Relocate Ticket
          </button>
        </div>
      )}

      {editingTicket && (
        <div className="input-group">
          <label>Status</label>
          {canModify ? (
            <div className="flex-row gap-sm">
              <button
                type="button"
                className={`btn flex-1 justify-center ${status === 'open' ? 'btn-danger' : 'btn-secondary'}`}
                onClick={() => setStatus('open')}
                disabled={isSubmitting}
              >
                <AlertCircle size={18} className="mr-sm" /> Open
              </button>
              <button
                type="button"
                className={`btn flex-1 justify-center ${status === 'resolved' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatus('resolved')}
                disabled={isSubmitting}
              >
                <CheckCircle size={18} className="mr-sm" /> Resolved
              </button>
            </div>
          ) : (
            <div className="items-center">
              <span className={`status-badge ${status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>
                {status === 'resolved' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                <span>{status.toUpperCase()}</span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="form-actions mt-xl flex items-center justify-between gap-sm">
        {canDelete ? (
          <button
            type="button"
            className="btn btn-danger btn-sm gap-xs"
            onClick={() => onDelete(editingTicket.id)}
            disabled={isSubmitting}
            title="Delete Issue"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        ) : <div />}

        <div className="flex items-center gap-xs">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {canModify ? 'Cancel' : 'Close'}
          </button>

          {canModify && (
            <button
              type="submit"
              className="btn btn-primary btn-sm gap-xs"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : (editingTicket ? 'Save Changes' : 'Report Issue')}
            </button>
          )}
        </div>
      </div>

      {editingTicket && (
        <div className="mt-xl text-xs text-muted">
          <p>Created: {new Date(editingTicket.created_at).toLocaleString()}</p>
          <p>Created by: {editingTicket.creator_name || editingTicket.creator_username || 'Unknown'}</p>
        </div>
      )}
    </form>
  );
}
