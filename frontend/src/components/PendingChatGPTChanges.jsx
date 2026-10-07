import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ClipboardCheck, X } from 'lucide-react';
import { api, getErrorMessage } from '../api';
import './PendingChatGPTChanges.css';

function ReviewModal({ onClose, onChanged }) {
  const dialogRef = useRef(null);
  const frameRef = useRef(null);
  const errorRef = useRef(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { dialog.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/chatgpt/review-view', { signal: controller.signal, responseType: 'text' }).then(({ data }) => setHtml(data))
      .catch((err) => { if (!controller.signal.aborted) setError(getErrorMessage(err, 'The review form could not be loaded.')); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const send = (result) => frameRef.current?.contentWindow?.postMessage(result, '*');
    const listener = async (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.method === 'ui/initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'EquipMap', version: '1' }, hostCapabilities: {} } });
        try {
          const { data } = await api.get('/api/chatgpt/review-pending');
          send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: data });
        } catch (err) {
          send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { error: getErrorMessage(err, 'Pending changes could not be loaded.') } });
        }
      } else if (message.method === 'tools/call') {
        try {
          const { name, arguments: args } = message.params ?? {};
          let response;
          if (name === 'review_pending_changes') response = await api.get('/api/chatgpt/review-pending');
          else if (name === 'submit_change_reviews') {
            response = await api.post('/api/chatgpt/review-pending', args);
            onChanged();
          } else throw new Error('Unsupported review action.');
          send({ jsonrpc: '2.0', id: message.id, result: response.data });
        } catch (err) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: getErrorMessage(err, 'The selected changes could not be submitted.') } }); }
      } else if (message.method === 'ui/notifications/size-changed') {
        const height = message.params?.height;
        if (Number.isFinite(height) && height > 0) frameRef.current?.style.setProperty('--pending-review-height', `${Math.ceil(height)}px`);
      } else if (message.method === 'ui/notifications/close') onClose();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [onChanged, onClose]);
  return <dialog ref={dialogRef} className="modal-card modal-lg glass-panel pending-chatgpt-modal" aria-labelledby="pending-chatgpt-modal-title" onCancel={onClose}>
    <header className="modal-card-header">
      <h2 id="pending-chatgpt-modal-title">Pending changes</h2>
      <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close pending changes" title="Close pending changes"><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="modal-card-body">
      {!html && !error && <p className="pending-chatgpt-message" role="status">Loading review form...</p>}
      {error && <div className="pending-chatgpt-error" role="alert" ref={errorRef} tabIndex={-1}><AlertCircle size={18} aria-hidden="true" /><p>{error}</p></div>}
      {html && <iframe ref={frameRef} srcDoc={html} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" title="Review pending EquipMap changes" className="pending-chatgpt-frame" />}
    </div>
  </dialog>;
}

export default function PendingChatGPTChanges({ refreshKey, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/api/chatgpt/pending-changes', { signal: controller.signal }).then(({ data }) => { setData(data); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(getErrorMessage(err, 'Pending changes could not be loaded.')); });
    return () => controller.abort();
  }, [refreshKey, reload]);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => { (triggerRef.current ?? document.querySelector('button[title="Refresh Logs"]'))?.focus(); });
  }, []);
  const changed = useCallback(() => { setReload((value) => value + 1); onChanged?.(); }, [onChanged]);
  return <>
    {data?.results.length > 0 && <div className="pending-chatgpt-trigger">
      <button ref={triggerRef} type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <ClipboardCheck size={18} aria-hidden="true" />Pending changes ({data.results.length}{data.has_more ? '+' : ''})
      </button>
    </div>}
    {error && <p className="pending-chatgpt-list-error" role="alert">{error}</p>}
    {open && <ReviewModal onClose={close} onChanged={changed} />}
  </>;
}
