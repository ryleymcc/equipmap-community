import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, ExternalLink, X } from 'lucide-react';
import { api, BASE_URL, getErrorMessage } from '../api';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import './EquipmentDocuments.css';

function DocumentsModal({ item, canEdit, returnFocus, onClose }) {
  const dialog = useRef(null);
  const online = useNetworkStatus();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/api/equipment/${item.id}/documents`;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); returnFocus?.focus(); };
  }, [returnFocus]);

  useEffect(() => {
    let active = true;
    api.get(endpoint).then(({ data }) => { if (active) setFiles(data); })
      .catch(err => { if (active) setError(getErrorMessage(err, 'Could not load documents. Try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint, attempt]);

  async function upload(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('Choose a file under 25 MB.'); input.value = ''; return;
    }
    setBusy(true); setError('');
    const data = new FormData(); data.append('file', file);
    try {
      const response = await api.post(endpoint, data);
      setFiles(previous => [response.data, ...previous]);
    } catch (err) { setError(getErrorMessage(err, 'Could not upload document. Try again.')); }
    finally { setBusy(false); input.value = ''; }
  }

  async function remove(file) {
    if (!window.confirm(`Remove “${file.filename}” from ${item.name}?`)) return;
    setBusy(true); setError('');
    try {
      await api.delete(`${endpoint}/${file.id}`);
      setFiles(previous => previous.filter(row => row.id !== file.id));
    } catch (err) { setError(getErrorMessage(err, 'Could not remove document. Try again.')); }
    finally { setBusy(false); }
  }

  return createPortal(<dialog ref={dialog} className="modal-card modal-lg glass-panel equipment-documents-modal"
    aria-labelledby="equipment-documents-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-card-header"><h2 id="equipment-documents-title">Documents &amp; manuals</h2>
      <button type="button" className="btn btn-secondary" autoFocus disabled={busy} aria-label="Close documents" title="Close documents" onClick={onClose}><X size={18} /></button></div>
    <div className="modal-card-body equipment-documents-body">
      <p className="equipment-documents-context">{item.name} · Files open in a new tab or your device’s viewer.</p>
      {!online && <p role="status">Documents require an internet connection.</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn btn-secondary" disabled={busy || !online} onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Reload documents</button></div>}
      {loading ? <p role="status">Loading documents…</p> : <>
        {files.length === 0 ? <p>No documents yet.{canEdit ? ' Add a manual or reference file below.' : ''}</p> :
          <ul className="equipment-documents-list">{files.map(file => <li key={file.id} className="equipment-documents-row">
            <div className="equipment-documents-details"><span>{file.filename}</span><small>{Math.max(1, Math.ceil(file.size_bytes / 1024))} KB</small></div>
            <div className="equipment-documents-actions"><a className="btn btn-secondary" href={`${BASE_URL}${file.path}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.filename}`}><ExternalLink size={16} />Open</a>
              {canEdit && <button type="button" className="btn btn-danger" disabled={busy || !online} aria-label={`Remove ${file.filename}`} onClick={() => remove(file)}>Remove</button>}</div>
          </li>)}</ul>}
      </>}
      {canEdit && <div className="equipment-documents-upload"><label htmlFor="equipment-document-file">Add document</label>
        <input id="equipment-document-file" type="file" className="input-field" accept=".pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={busy || loading || !online} onChange={upload} />
        <p className="equipment-documents-context">PDF, text, Word, Excel or PowerPoint · up to 25 MB per file</p>
        {busy && <span role="status">Saving document changes…</span>}
      </div>}
    </div>
    <div className="modal-card-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Close</button></div>
  </dialog>, document.body);
}

export default function EquipmentDocuments({ item, canEdit }) {
  const [trigger, setTrigger] = useState(null);
  return <div className="equipment-documents">
    <button type="button" className="btn btn-secondary" onClick={event => setTrigger(event.currentTarget)}><FileText size={16} />Documents &amp; manuals</button>
    {trigger && <DocumentsModal key={item.id} item={item} canEdit={canEdit} returnFocus={trigger} onClose={() => setTrigger(null)} />}
  </div>;
}
