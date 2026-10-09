import { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Save, X } from 'lucide-react';
import { createTaskType, getErrorMessage, getTaskTypes, updateTaskType } from '../api';

const EMPTY_FORM = { code: '', name: '', category: 'General', priority: 'medium', trade: '', is_active: true, task_sheet_id: '' };

export default function TaskTypesPanel({ categories, trades, taskSheets }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const sheetOptions = useMemo(() => taskSheets.filter(item => item.pm_task_sheet?.trim()), [taskSheets]);

  const load = async () => {
    try {
      setLoading(true);
      setItems((await getTaskTypes()).data || []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Task types could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const beginCreate = () => { setEditingId('new'); setForm(EMPTY_FORM); };
  const beginEdit = item => {
    setEditingId(item.id);
    setForm({ ...item, trade: item.trade || '', task_sheet_id: item.task_sheet_id || '' });
  };
  const cancel = () => { setEditingId(null); setForm(EMPTY_FORM); setError(''); };
  const submit = async event => {
    event.preventDefault();
    const payload = { ...form, task_sheet_id: form.task_sheet_id ? Number(form.task_sheet_id) : null };
    try {
      if (editingId === 'new') await createTaskType(payload);
      else await updateTaskType(editingId, payload);
      cancel();
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Task type could not be saved.'));
    }
  };

  return <section className="task-types-panel" aria-labelledby="task-types-heading">
    <div className="task-categories-panel-header">
      <div><h2 id="task-types-heading">Task types</h2><p>Task types classify work. A task sheet is an optional linked procedure.</p></div>
      {editingId === null && <button type="button" className="btn btn-primary btn-sm gap-xs" onClick={beginCreate}><Plus size={15} /> Add task type</button>}
    </div>
    {error && <div className="alert-box-danger-left" role="alert">{error}</div>}
    {editingId !== null && <form className="task-type-form glass-panel" onSubmit={submit}>
      <div className="task-form-field"><label htmlFor="task-type-code">Code</label><input id="task-type-code" className="input-field" required value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} /></div>
      <div className="task-form-field"><label htmlFor="task-type-name">Task type</label><input id="task-type-name" className="input-field" required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></div>
      <div className="task-form-field"><label htmlFor="task-type-category">Category</label><select id="task-type-category" className="input-field" value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))}>{categories.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
      <div className="task-form-field"><label htmlFor="task-type-priority">Priority</label><select id="task-type-priority" className="input-field" value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
      <div className="task-form-field"><label htmlFor="task-type-trade">Assigned trade</label><select id="task-type-trade" className="input-field" value={form.trade} onChange={event => setForm(current => ({ ...current, trade: event.target.value }))}><option value="">Unassigned</option>{trades.map(trade => <option key={trade}>{trade}</option>)}</select></div>
      <div className="task-form-field"><label htmlFor="task-type-sheet">Linked task sheet</label><select id="task-type-sheet" className="input-field" value={form.task_sheet_id} onChange={event => setForm(current => ({ ...current, task_sheet_id: event.target.value }))}><option value="">No task sheet</option>{sheetOptions.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.code} — {sheet.description}</option>)}</select></div>
      <label className="task-type-status-control"><input type="checkbox" checked={form.is_active} onChange={event => setForm(current => ({ ...current, is_active: event.target.checked }))} /> Active</label>
      <div className="task-categories-form-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button><button type="submit" className="btn btn-primary btn-sm"><Save size={14} /> Save task type</button></div>
    </form>}
    {loading ? <div className="task-list-state" role="status">Loading task types…</div> : <div className="task-type-table-wrap"><table className="list-table task-type-table"><thead><tr><th>Category</th><th>Task type</th><th>Priority</th><th>Status</th><th>Assigned trade</th><th>Linked task sheet</th><th>Actions</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td data-label="Category">{item.category}</td><td data-label="Task type"><strong>{item.name}</strong><small>{item.code}</small></td><td data-label="Priority"><span className={`badge priority-${item.priority}`}>{item.priority}</span></td><td data-label="Status"><span className={`badge ${item.is_active ? 'badge-success' : 'badge-secondary'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td><td data-label="Assigned trade">{item.trade || 'Unassigned'}</td><td data-label="Linked task sheet">{item.task_sheet_name || 'No task sheet'}</td><td data-label="Actions"><button type="button" className="row-action-btn" onClick={() => beginEdit(item)} aria-label={`Edit ${item.name}`}><Edit2 size={15} /></button></td></tr>)}</tbody></table></div>}
  </section>;
}
