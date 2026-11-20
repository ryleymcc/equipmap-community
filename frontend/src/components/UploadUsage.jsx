import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import { api, getErrorMessage } from '../api';
import './DataManager.css';

export default function UploadUsage({ file, returnFocus, onClose }) {
  const dialog = useRef(null);
  const [uses, setUses] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    setUses(null);
    try {
      const response = await api.get('/api/data-manager/uploads/usage', { params: { path: file.path } });
      setUses(response.data.uses);
    } catch (err) { setError(getErrorMessage(err, 'Could not load file usage. Try again.')); }
  }, [file.path]);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    queueMicrotask(load);
    return () => { element.close(); returnFocus?.focus(); };
  }, [load, returnFocus]);
  return <dialog ref={dialog} className="data-manager-preview modal-card glass-panel" aria-label={`Usage of ${file.path}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-card-header data-manager-preview-header"><h2>Used by</h2><button type="button" className="btn btn-secondary" aria-label="Close file usage" title="Close file usage" autoFocus onClick={onClose}><X size={18} /></button></div>
    <div className="modal-card-body data-manager-preview-body">
      <p className="data-manager-path">{file.path}</p>
      {error ? <><p className="text-danger" role="alert">{error}</p><button type="button" className="btn btn-secondary" onClick={load}>Retry</button></>
        : uses === null ? <p role="status">Loading file usage…</p>
        : !uses.length ? <p>No current uses were found. Close this window and refresh uploads.</p>
        : <ul className="data-manager-usage-list">{uses.map(use => {
          const room = use.type === 'rooms';
          const entity = use.type === 'rooms' || use.type === 'equipment';
          const destination = entity ? `/map/${use.floorplan_id}` : `/floorplans?siteId=${use.site_id}`;
          const state = entity ? { restoreState: true, mapState: { [room ? 'editingRoom' : 'editingEquipment']: use.entity }, returnTo: { pathname: '/audit-log/data' } } : undefined;
          return <li key={`${use.type}-${use.id}-${use.relationship}`}>
            <div><strong>{use.name}</strong><p>{room ? 'Room' : use.type === 'equipment' ? 'Equipment' : 'Floorplan'} · {use.relationship}</p></div>
            <Link className="btn btn-secondary" to={destination} state={state}><ExternalLink size={16} />Open {entity ? room ? 'room' : 'equipment' : 'floorplans'}</Link>
          </li>;
        })}</ul>}
      {uses?.some(use => use.type === 'rooms' || use.type === 'equipment') && <p className="data-manager-note">Open the record, then use Remove photo to unlink it. The file may remain protected by undo history.</p>}
      {uses?.some(use => use.type === 'floorplans') && <p className="data-manager-note">Drawing files are managed from the floorplan menu. Replace the drawing there rather than deleting an in-use file.</p>}
    </div>
  </dialog>;
}
