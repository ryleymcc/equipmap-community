import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit2, Layers, Plus, Save, Search, X } from 'lucide-react';
import { createTaskCategory, getErrorMessage, getTaskCategories, updateTaskCategory } from '../api';

export default function TaskCategoriesPanel({ onCategoriesChanged }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getTaskCategories();
      setCategories(response.data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Task categories could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(loadCategories, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const filteredCategories = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return categories;
    return categories.filter(item => item.name.toLowerCase().includes(term) || (item.description || '').toLowerCase().includes(term));
  }, [query, categories]);

  const resetForm = () => {
    setEditingName(null);
    setName('');
    setDescription('');
    setError(null);
  };

  const startEdit = (item) => {
    setEditingName(item.name);
    setName(item.name);
    setDescription(item.description || '');
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a task category name.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      if (editingName) {
        await updateTaskCategory(editingName, { name: name.trim(), description: description.trim() || null });
      } else {
        await createTaskCategory({ name: name.trim(), description: description.trim() || null });
      }
      resetForm();
      await loadCategories();
      onCategoriesChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Task category could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item) => {
    try {
      setError(null);
      await updateTaskCategory(item.name, { is_active: !item.is_active });
      await loadCategories();
      onCategoriesChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Task category status could not be updated.'));
    }
  };

  return (
    <section className="task-categories-panel glass-panel" aria-labelledby="task-categories-heading">
      <div className="task-categories-toolbar">
        <div><h2 id="task-categories-heading">Task categories</h2><p>Maintain the categories used by task types, PM schedules, and generated work orders.</p></div>
        {editingName === null && <button type="button" className="btn btn-primary btn-sm gap-xs" onClick={() => setEditingName('')}><Plus size={15} /> Add category</button>}
      </div>
      {error && <div className="alert-box-danger-left task-categories-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
      {editingName !== null && (
        <form className="task-categories-form" onSubmit={handleSubmit}>
          <div className="task-form-field"><label htmlFor="task-category-name">Name</label><input id="task-category-name" className="input-field" value={name} onChange={event => setName(event.target.value)} autoFocus required /></div>
          <div className="task-form-field"><label htmlFor="task-category-description">Description <span>Optional</span></label><input id="task-category-description" className="input-field" value={description} onChange={event => setDescription(event.target.value)} /></div>
          <div className="task-categories-form-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}><X size={14} /> Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save category'}</button></div>
        </form>
      )}
      <div className="filter-search-control task-categories-search"><Search size={15} className="filter-search-icon" /><input className="input-field filter-control" aria-label="Search task categories" placeholder="Search categories…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {loading ? <div className="task-list-state" role="status">Loading task categories…</div> : filteredCategories.length === 0 ? <div className="task-list-state empty-state-box"><Layers size={28} /><h3>No task categories found</h3><p>Add a category to make it available to task types.</p></div> : (
        <div className="task-categories-list">{filteredCategories.map(item => <article className="task-category-row" key={item.name}><div className="task-category-copy"><div><strong>{item.name}</strong><span className={`badge ${item.is_active ? 'badge-success' : 'badge-secondary'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></div><p>{item.description || 'No description'}</p><small>{item.task_count} task type{item.task_count === 1 ? '' : 's'}</small></div><div className="task-row-actions"><button type="button" className="row-action-btn" onClick={() => startEdit(item)} title={`Edit ${item.name}`} aria-label={`Edit ${item.name}`}><Edit2 size={15} /></button><button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(item)}><CheckCircle2 size={14} /> {item.is_active ? 'Deactivate' : 'Activate'}</button></div></article>)}</div>
      )}
    </section>
  );
}
