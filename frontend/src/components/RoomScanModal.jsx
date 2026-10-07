import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import { updateCachedFloorplanItem } from '../cacheUtils';
import './RoomScanModal.css';

export default function RoomScanModal({ floorplan, onClose, onApplied }) {
  const [dpi, setDpi] = useState(450);
  const [job, setJob] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [zoom, setZoom] = useState('1');
  const dialog = useRef(null);
  const scanning = busy || ['queued', 'scanning'].includes(job?.status);
  const base = `/api/floorplans/${floorplan.id}/room-scan`;

  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);

  useEffect(() => {
    if (!job?.id || !['queued', 'scanning'].includes(job.status)) return;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const { data } = await api.get(`${base}/${job.id}`);
        if (!active) return;
        if (data.status === 'ready') setSelected(new Set(data.rows.filter(r => r.selected).map(r => r.id)));
        if (data.status === 'error') setError(data.error);
        setJob(data);
        if (['queued', 'scanning'].includes(data.status)) timer = setTimeout(poll, 1500);
      } catch (err) {
        if (active) {
          setError(err.response?.data?.detail || 'Could not check scan progress. Reopen this window and retry.');
          setJob(previous => ({ ...previous, status: 'error' }));
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [base, job?.id, job?.status]);

  async function start() {
    setBusy(true); setError(''); setSuccess('');
    try {
      const { data } = await api.post(base, { dpi });
      setJob({ id: data.id, dpi: data.dpi, status: 'queued', progress: 0, rows: [] });
    } catch (err) { setError(err.response?.data?.detail || 'Could not start the scan. Try again.'); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`${base}/${job.id}/apply`, { selected_ids: [...selected] });
      setSuccess(`${data.moved} rooms moved; ${data.created} rooms created.`);
      setJob(previous => ({ ...previous, status: 'applied' }));
      // Refresh existing caches so entering the map cannot briefly show old pins.
      try {
        const fresh = await api.get(`/api/floorplans/${floorplan.id}/rooms`);
        const existingIds = new Set((floorplan.rooms || []).map(room => room.id));
        for (const room of fresh.data) await updateCachedFloorplanItem(floorplan.id, 'room', existingIds.has(room.id) ? 'update' : 'add', room, floorplan.site_id);
      } catch { setError('Pins were saved. Refresh the map if it still shows old locations.'); }
    } catch (err) { setError(err.response?.data?.detail || 'Could not apply pins. Try again.'); }
    finally { setBusy(false); }
  }

  function keyDown(event) {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <div className="modal-overlay modal-backdrop-dark">
    <div className="modal-card modal-xl glass-panel room-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="room-scan-title" ref={dialog} tabIndex={-1} onKeyDown={keyDown}>
      <div className="modal-card-header">
        <h2 id="room-scan-title">Generate room pins</h2>
        <button className="btn btn-secondary" aria-label="Close room scan" disabled={busy} onClick={onClose}><X size={18} /></button>
      </div>
      <div className="modal-card-body room-scan-body">
        <p>{floorplan.name} · First page only. Review detected codes before applying pins.</p>
        <p>Matches ignore case, spaces, hyphens and leading zeros: 1EN01 matches 1EN1. Existing room names and linked records are preserved.</p>
        {job?.status !== 'applied' && <div className="room-scan-field">
          <label htmlFor="room-scan-dpi">Scan resolution</label>
          <select id="room-scan-dpi" className="input-field" value={dpi} disabled={scanning} aria-describedby="room-scan-dpi-help" onChange={event => setDpi(Number(event.target.value))}>
            <option value={300}>300 DPI</option>
            <option value={450}>450 DPI</option>
            <option value={600}>600 DPI</option>
            <option value={900}>900 DPI</option>
            <option value={1200}>1200 DPI</option>
          </select>
          <p id="room-scan-dpi-help">Higher DPI gives small labels more detail and takes longer. Try 300–600 DPI first; enlarging a blurry source cannot recover missing detail.</p>
          {job?.status === 'ready' && <button className="btn btn-secondary" disabled={scanning} onClick={start}>Rescan floorplan</button>}
        </div>}
        {scanning && <p role="status">{busy ? 'Working…' : `${job.status === 'queued' ? 'Waiting to scan' : 'Reading drawing'} · ${job.progress}%`} · {job?.dpi || dpi} DPI</p>}
        {error && <p className="text-danger" role="alert">{error}</p>}
        {job?.status === 'ready' && <p>Scanned at {job.dpi} DPI.</p>}
        {success && <p role="status">{success}</p>}
        {job?.status === 'ready' && <>
          <p>{job.rows.length} unique codes detected. Confident existing matches are selected; check the drawing before selecting other pins. Ambiguous codes are skipped.</p>
          {job.image && <>
            <div className="room-scan-field">
              <label htmlFor="room-scan-zoom">Drawing zoom</label>
              <select id="room-scan-zoom" className="input-field" value={zoom} onChange={event => setZoom(event.target.value)}>
                <option value="1">Fit drawing</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option>
              </select>
            </div>
            <div className="room-scan-drawing" tabIndex={0} role="region" aria-label="Drawing preview; scroll to inspect zoomed locations">
            <svg className={`room-scan-preview room-scan-zoom-${zoom}`} viewBox={`0 0 2000 ${job.height}`} role="img" aria-label="Floorplan preview with selected room locations">
            <image href={job.image} width="2000" height={job.height} />
            {job.rows.filter(r => selected.has(r.id)).map(row => <circle key={row.id} cx={row.x_coordinate} cy={row.y_coordinate} r="10"><title>{row.name}</title></circle>)}
            </svg>
            </div>
          </>}
          {!job.rows.length && <p>No room codes found. Try a clearer source drawing or a different resolution.</p>}
          <div className="room-scan-results">
            {job.rows.map(row => <label key={row.id} className="room-scan-row">
              <input type="checkbox" disabled={busy || row.action === 'review'} checked={selected.has(row.id)} onChange={e => setSelected(previous => { const next = new Set(previous); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
              <span><strong>{row.name}</strong>{row.existing_name && row.existing_name !== row.name ? ` → ${row.existing_name}` : ''}<span className="room-scan-reason">{row.reason} · {row.confidence}% confidence</span></span>
              <span>{row.action === 'review' ? 'Skipped' : row.action === 'move' ? 'Move' : 'New'}</span>
            </label>)}
          </div>
        </>}
      </div>
      <div className="modal-card-footer room-scan-footer">
        <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Close</button>
        {job?.status === 'ready' ? <button className="btn btn-primary" disabled={scanning || !selected.size} onClick={apply}>Apply {selected.size} {selected.size === 1 ? 'pin' : 'pins'}</button>
          : job?.status === 'applied' ? <button className="btn btn-primary" onClick={onApplied}>View room pins</button>
          : <button className="btn btn-primary" disabled={scanning} onClick={start}>{error ? 'Retry scan' : 'Scan floorplan'}</button>}
      </div>
    </div>
  </div>;
}
