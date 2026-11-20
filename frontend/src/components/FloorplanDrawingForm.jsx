import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getErrorMessage } from '../api';
import { DRAWING_DISCIPLINES } from '../floorplanDrawings';

const TITLE_LIMIT = 160;

export default function FloorplanDrawingForm({ item, discipline, disciplines, onSave, onClose, returnFocus }) {
  const dialog = useRef(null);
  const [title, setTitle] = useState(item?.title || '');
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disciplineOptions = new Map([...Object.entries(DRAWING_DISCIPLINES), ...disciplines]);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); returnFocus?.focus(); };
  }, [returnFocus]);
  const selectFile = event => {
    const filename = event.currentTarget.files[0]?.name || '';
    const nextTitle = (filename.replace(/\.[^.]+$/, '').trim() || filename).slice(0, TITLE_LIMIT);
    if (!title.trim() || title === suggestedTitle) setTitle(nextTitle);
    setSuggestedTitle(nextTitle);
  };
  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setBusy(true); setError('');
    try {
      const data = new FormData(form);
      await onSave(item ? { ...Object.fromEntries(data), page_number: Number(data.get('page_number')) } : data);
      onClose();
    } catch (err) { setError(getErrorMessage(err, 'Could not save the drawing. Try again.')); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="drawing-form modal-card modal-lg glass-panel" aria-labelledby="drawing-form-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-card-header"><h2 id="drawing-form-title">{item ? 'Edit drawing details' : 'Upload drawing'}</h2>
      <button type="button" className="btn btn-secondary" aria-label="Close drawing form" title="Close drawing form" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <form id="drawing-form" className="modal-card-body equip-form" onSubmit={submit}>
      {!item && <div className="equip-field"><label htmlFor="drawing-file">Drawing file</label><input autoFocus id="drawing-file" name="file" className="input-field" type="file" accept=".pdf,.svg,.png,.jpg,.jpeg,.webp" onChange={selectFile} required />
        <p className="drawing-note">PDF, SVG or image, up to 50 MB. Each upload is one sheet or one PDF page.</p></div>}
      <div className="equip-field"><label htmlFor="drawing-title">Title</label><input autoFocus={!!item} id="drawing-title" name="title" className="input-field" value={title} onChange={event => setTitle(event.target.value)} maxLength={TITLE_LIMIT} required /></div>
      <div className="drawing-form-grid">
        <div className="equip-field">
          <label htmlFor="drawing-discipline">Discipline</label>
          <input id="drawing-discipline" name="discipline" className="input-field" list="drawing-discipline-options"
            aria-describedby="drawing-discipline-help" defaultValue={disciplineOptions.get(item?.discipline ?? discipline)}
            autoComplete="off" maxLength={80} pattern=".*\S.*" required />
          <datalist id="drawing-discipline-options">
            {[...disciplineOptions].map(([value, label]) => <option key={value} value={label} />)}
          </datalist>
          <p id="drawing-discipline-help" className="drawing-note">Choose a discipline or type a new one.</p>
        </div>
        <div className="equip-field"><label htmlFor="drawing-number">Drawing number</label><input id="drawing-number" name="sheet_number" className="input-field" maxLength={80} defaultValue={item?.sheet_number || ''} /></div>
        <div className="equip-field"><label htmlFor="drawing-project">Project / area</label><input id="drawing-project" name="project" className="input-field" maxLength={160} defaultValue={item?.project || ''} /></div>
        <div className="equip-field"><label htmlFor="drawing-date">Drawing date</label><input id="drawing-date" name="drawing_date" className="input-field" type="date" defaultValue={item?.drawing_date || ''} /></div>
        <div className="equip-field"><label htmlFor="drawing-revision">Revision</label><input id="drawing-revision" name="revision" className="input-field" maxLength={80} defaultValue={item?.revision || ''} /></div>
        <div className="equip-field"><label htmlFor="drawing-page">PDF page</label><input id="drawing-page" name="page_number" className="input-field" type="number" min="1" max="10000" step="1" defaultValue={item?.page_number || 1} /></div>
      </div>
      <p className="drawing-note">Uploaded sheets start as reference documents. Align a sheet and mark its coverage to show it on the floorplan.</p>
      {error && <p className="text-danger" role="alert">{error}</p>}
    </form>
    <div className="modal-card-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="drawing-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save details' : 'Upload drawing'}</button></div>
  </dialog>;
}
