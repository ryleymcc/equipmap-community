import { ListChecks, Sparkles } from 'lucide-react';
import './TaskTemplateLinkSelector.css';

export default function TaskTemplateLinkSelector({
  linkedTask,
  checklistCount = 0,
  onOpen,
  onUnlink,
  isLoading = false,
  emptyText = 'Link an existing task sheet to auto-populate instructions and checklists',
}) {
  if (isLoading) {
    return (
      <div className="task-template-link is-loading" role="status" aria-live="polite">
        <div className="task-template-link-summary">
          <span className="task-template-link-icon" aria-hidden="true"><ListChecks size={16} /></span>
          <span className="task-template-link-name">Loading task sheet…</span>
        </div>
      </div>
    );
  }

  if (linkedTask) {
    return (
      <div className="task-template-link is-linked">
        <div className="task-template-link-summary">
            <span className="task-template-link-badge">
              <ListChecks size={13} />
              Linked task sheet
          </span>
          <span className="task-template-link-name">
            <strong>{linkedTask.description || linkedTask.code || `Task #${linkedTask.id}`}</strong>
            {checklistCount > 0 && ` (${checklistCount} checklist items)`}
          </span>
        </div>
        <div className="task-template-link-actions">
          <button type="button" className="btn btn-secondary btn-xs gap-xs" onClick={onOpen}>
            <Sparkles size={14} className="text-primary" />
            <span>Change sheet</span>
          </button>
          <button type="button" className="btn btn-ghost btn-xs text-muted" onClick={onUnlink}>Unlink sheet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-template-link is-empty">
      <div className="task-template-link-summary">
        <span className="task-template-link-icon" aria-hidden="true"><ListChecks size={18} /></span>
        <span className="task-template-link-name">{emptyText}</span>
      </div>
      <button type="button" className="btn btn-secondary btn-xs gap-xs" onClick={onOpen}>
        <Sparkles size={14} className="text-primary" />
        <span>Link task sheet</span>
      </button>
    </div>
  );
}
