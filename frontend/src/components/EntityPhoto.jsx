import { useId, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Maximize, X } from 'lucide-react';
import { api, getErrorMessage } from '../api';
import { getCachedDashboardData, updateCachedFloorplanItem } from '../cacheUtils';
import { cachePhotoThumbnails, photoUrl } from '../photoCache';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import './EntityPhoto.css';
import PhotoFullscreen from './PhotoFullscreen';
import { captureDiagnostic, diagnosticBreadcrumb } from '../diagnostics';

function PhotoPanel({ item, kind, canEdit, compact = false }) {
  const online = useNetworkStatus();
  const input = useRef(null);
  const [fullscreen, setFullscreen] = useState(null);
  const inputId = useId();
  // Chrome's Android media-only picker can omit Camera. A generic MIME type
  // requests the native file/camera chooser; validate the selected image below.
  const photoAccept = /Android/i.test(navigator.userAgent) ? 'image/*,application/octet-stream' : 'image/*';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState([]);
  const [loaded, setLoaded] = useState('');
  const thumb = item.photo_thumbnail_path;
  // Legacy originals are never loaded: only processed derivatives are safe for this UI.
  const preview = thumb ? item.photo_path : null;
  const desired = online && !compact ? preview : thumb;
  const path = !failed.includes(desired) ? desired : !failed.includes(thumb) ? thumb : null;

  async function change(file) {
    diagnosticBreadcrumb('Photo selection returned', { kind, has_file: Boolean(file), bytes: file?.size, mime_type: file?.type, online, busy });
    if (busy || !canEdit) return;
    if (!online) {
      setError('You are offline. Reconnect, then choose the photo again.');
      return;
    }
    if (file && file.size > 12 * 1024 * 1024) {
      setError('Choose an image under 12 MB.');
      return;
    }
    if (file && file.type && !file.type.startsWith('image/')) {
      setError('Choose a valid JPEG, PNG or WebP image.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const endpoint = `/api/${kind}/${item.id}/photo`;
      let response;
      if (file) {
        const data = new FormData();
        data.append('photo', file);
        response = await api.post(endpoint, data);
      } else {
        response = await api.delete(endpoint);
      }
      const updated = { ...item, ...response.data };
      diagnosticBreadcrumb('Photo update saved', { kind });
      // Update the screen immediately; offline cache writes must not hide a successful upload.
      window.dispatchEvent(new CustomEvent('entity-photo-updated', { detail: { kind, item: updated } }));
      const cachedSites = getCachedDashboardData('sites') || [];
      const siteId = item.site_id || cachedSites.find(site =>
        (getCachedDashboardData(`floorplans_${site.id}`) || []).some(fp => fp.id === item.floorplan_id))?.id;
      await updateCachedFloorplanItem(item.floorplan_id, kind === 'rooms' ? 'room' : 'equipment', 'update', updated, siteId);
      await cachePhotoThumbnails([updated]);
    } catch (err) {
      captureDiagnostic(err, 'photo.update', { stage: file ? 'upload-or-cache' : 'remove-or-cache', kind });
      setError(getErrorMessage(err, 'Could not update photo. Try again.'));
    } finally {
      setBusy(false);
      if (input.current) {
        input.current.value = '';
      }
    }
  }

  function openPicker() {
    if (busy || !online || !input.current) return;
    input.current.value = '';
    diagnosticBreadcrumb('Photo picker opened', { kind });
    input.current.click();
  }

  return (
    <section className={`entity-photo ${compact ? 'entity-photo-compact' : ''}`} aria-label={`Photo of ${item.name}`}>
      {path ? <div className="entity-photo-frame">
        <img key={path} className="entity-photo-image" src={photoUrl(path)} alt={item.name}
          loading="lazy" decoding="async" onLoad={() => setLoaded(path)} onError={() => setFailed(previous => [...previous, path])} />
        <button type="button" className="btn btn-secondary entity-photo-expand" aria-label="Full screen" title="Full screen"
          onClick={event => setFullscreen(event.currentTarget)}><Maximize size={16} /></button>
      </div> : <span className="text-secondary">{desired ? 'Photo unavailable' : 'No photo'}</span>}
      {fullscreen && path && <PhotoFullscreen key={path} path={path} name={item.name} offline={!online}
        returnFocus={fullscreen} onClose={() => setFullscreen(null)}
        onImageError={() => setFailed(previous => [...previous, path])} />}
      {path && loaded !== path && <span className="text-secondary" role="status">Loading photo…</span>}
      {!compact && !online && <p className="text-secondary">Offline · saved thumbnail only</p>}
      {!compact && online && failed.includes(preview) && thumb && <p className="text-secondary">Preview unavailable · showing thumbnail</p>}
      {canEdit && !compact && <div className="entity-photo-actions">
        <label htmlFor={inputId} className="entity-photo-file">Choose photo for {item.name}</label>
        <input ref={input} id={inputId} className="entity-photo-file" type="file" accept={photoAccept}
          disabled={busy || !online} onChange={e => { if (e.target.files?.[0]) change(e.target.files[0]); }} />
        <button type="button" className="btn btn-secondary" disabled={busy || !online} onClick={openPicker}
          title={item.photo_path ? 'Replace photo' : 'Add photo'}>
          <ImagePlus size={16} />{busy ? 'Processing…' : item.photo_path ? 'Replace photo' : 'Add photo'}
        </button>
        {item.photo_path && <button type="button" className="btn btn-danger" disabled={busy || !online}
          onClick={() => { if (window.confirm(`Remove the photo from ${item.name}?`)) change(null); }}>Remove photo</button>}
        <p className="text-secondary">JPEG, PNG or WebP · up to 12 MB and 24 megapixels</p>
      </div>}
      {error && <p className="text-danger" role="alert">{error}</p>}
    </section>
  );
}

export default function EntityPhoto({ item, kind, canEdit = false, compact = false }) {
  const [override, setOverride] = useState(null);
  const [open, setOpen] = useState(false);
  const [failedThumb, setFailedThumb] = useState('');
  const dialog = useRef(null);
  const trigger = useRef(null);
  const current = override?.id === item.id ? { ...item, ...override } : item;
  useEffect(() => {
    const changed = e => { if (e.detail.kind === kind && e.detail.item.id === item.id) setOverride({ id: item.id, photo_path: e.detail.item.photo_path, photo_thumbnail_path: e.detail.item.photo_thumbnail_path }); };
    window.addEventListener('entity-photo-updated', changed);
    return () => window.removeEventListener('entity-photo-updated', changed);
  }, [kind, item.id]);
  useEffect(() => {
    if (!open) return;
    dialog.current.showModal();
    const returnFocus = trigger.current;
    return () => returnFocus?.focus();
  }, [open]);
  if (!compact) return <PhotoPanel key={`${kind}-${item.id}`} item={current} kind={kind} canEdit={canEdit} />;
  return <>
    <button ref={trigger} type="button" className="entity-photo-trigger" title={`View photo of ${item.name}`}
      aria-label={`View photo of ${item.name}`} onClick={() => setOpen(true)}>
      {current.photo_thumbnail_path && failedThumb !== current.photo_thumbnail_path ? <img src={photoUrl(current.photo_thumbnail_path)} alt="" loading="lazy" decoding="async" onError={() => setFailedThumb(current.photo_thumbnail_path)} /> : <ImagePlus size={18} />}
    </button>
    {open && createPortal(<dialog ref={dialog} className="entity-photo-dialog modal-card glass-panel" onCancel={() => setOpen(false)} aria-label={`Photo of ${item.name}`}>
      <div className="modal-card-header"><h2>{item.name}</h2><button type="button" className="btn btn-ghost" aria-label="Close photo" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <div className="modal-card-body"><PhotoPanel key={`${kind}-${item.id}`} item={current} kind={kind} canEdit={canEdit} /></div>
    </dialog>, document.body)}
  </>;
}
