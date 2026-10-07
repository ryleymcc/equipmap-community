import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, Link2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { api, getErrorMessage } from '../api';
import './ChatGPTConnect.css';

function ConnectionScreen({ handle, user }) {
  const [details, setDetails] = useState(null);
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actionLock = useRef(false);
  const errorRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const path = handle ? `/api/chatgpt/requests/${encodeURIComponent(handle)}` : '/api/chatgpt/connections';
    api.get(path, { signal: controller.signal }).then(({ data }) => {
      if (handle) setDetails(data);
      else setConnections(data);
      setLoading(false);
    }).catch((err) => {
      if (!controller.signal.aborted) {
        setError(getErrorMessage(err, 'The ChatGPT connection could not be loaded.'));
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [handle]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const consent = async (approve) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/api/chatgpt/requests/${encodeURIComponent(handle)}`, { approve });
      // Only the backend chooses the pre-registered OAuth callback.
      window.location.assign(data.redirect_url);
    } catch (err) {
      setError(getErrorMessage(err, 'The connection could not be completed. Try again.'));
      actionLock.current = false;
      setBusy(false);
    }
  };

  const disconnect = async (id) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/chatgpt/connections/${encodeURIComponent(id)}`);
      setConnections((current) => current.filter((item) => item.id !== id));
      setNotice('ChatGPT access was disconnected.');
      headingRef.current?.focus();
    } catch (err) {
      setError(getErrorMessage(err, 'The connection could not be disconnected. Try again.'));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="chatgpt-connect-page">
      <section className="chatgpt-connect-panel glass-panel" aria-labelledby="chatgpt-connect-title" aria-busy={loading || busy}>
        <header className="chatgpt-connect-header">
          <Link2 size={20} aria-hidden="true" />
          <h1 id="chatgpt-connect-title" ref={headingRef} tabIndex={-1}>
            {handle ? 'Connect ChatGPT' : 'ChatGPT connections'}
          </h1>
        </header>
        <p className="chatgpt-connect-account">Signed in as <strong>{user.username}</strong></p>
        {loading && <p role="status">Loading connection details…</p>}
        {error && <div className="chatgpt-connect-error" role="alert" ref={errorRef} tabIndex={-1}>
          <AlertCircle size={18} aria-hidden="true" /><p>{error}</p>
        </div>}
        {notice && <p className="chatgpt-connect-notice" role="status">{notice}</p>}
        {!loading && details && <>
          <div className="chatgpt-connect-permissions">
            <h2><ShieldCheck size={18} aria-hidden="true" />Read-only access</h2>
            <p>Allow ChatGPT to read equipment, rooms, descriptions, and floorplans from this EquipMap installation.</p>
            <p>It can show locations and prepare changes for your review. You can select, edit and approve changes in the chat review form or EquipMap using your edit permissions. ChatGPT cannot approve changes itself or operate equipment.</p>
          </div>
          <p>You can disconnect this access at any time.</p>
          <div className="chatgpt-connect-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => consent(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => consent(true)}>
              {busy ? 'Returning to ChatGPT…' : 'Allow read-only access'}
            </button>
          </div>
        </>}
        {!loading && !handle && connections !== null && <div className="chatgpt-connect-list">
          {connections.length === 0 ? <p>No active ChatGPT connections. Start a connection from ChatGPT to link your account.</p> :
            connections.map((item) => <div className="chatgpt-connect-row" key={item.id}>
              <div><h2>ChatGPT</h2><p>Connected {new Date(item.created_at).toLocaleDateString()}</p>
                <p>Expires {new Date(item.expires_at).toLocaleDateString()}</p></div>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => disconnect(item.id)}
                aria-label={`Disconnect ChatGPT connection from ${new Date(item.created_at).toLocaleString()}`}>Disconnect</button>
            </div>)}
        </div>}
        <footer className="chatgpt-connect-links">
          {handle && <Link to="/connect/chatgpt">Manage connections</Link>}
          <Link to="/">Back to EquipMap</Link>
        </footer>
      </section>
    </main>
  );
}

function ChangeReview({ handle, user }) {
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef(null);
  const headingRef = useRef(null);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/api/chatgpt/changes/${encodeURIComponent(handle)}`, { signal: controller.signal })
      .then(({ data }) => setDetails(data))
      .catch((err) => { if (!controller.signal.aborted) setError(getErrorMessage(err, 'This change could not be loaded.')); });
    return () => controller.abort();
  }, [handle]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const confirm = async (approve) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/api/chatgpt/changes/${encodeURIComponent(handle)}`, { approve });
      setDetails(data);
      headingRef.current?.focus();
    } catch (err) {
      setError(getErrorMessage(err, 'This change could not be saved.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const preview = details?.preview;
  return <main className="chatgpt-connect-page">
    <section className="chatgpt-connect-panel glass-panel" aria-labelledby="chatgpt-change-title" aria-busy={busy}>
      <header className="chatgpt-connect-header"><ShieldCheck size={20} aria-hidden="true" />
        <h1 id="chatgpt-change-title" ref={headingRef} tabIndex={-1}>Review ChatGPT change</h1></header>
      <p className="chatgpt-connect-account">Signed in as <strong>{user.username}</strong></p>
      {!details && !error && <p role="status">Loading proposed change…</p>}
      {error && <div className="chatgpt-connect-error" role="alert" ref={errorRef} tabIndex={-1}>
        <AlertCircle size={18} aria-hidden="true" /><p>{error}</p></div>}
      {preview && <>
        <div><h2>{preview.record_name}</h2><p className="chatgpt-connect-account">{preview.context}</p></div>
        <p>{details.status === 'pending' ? 'Review each value before saving. The floorplan pin stays unchanged.' :
          details.status === 'applied' ? `Saved. Audit entry ${details.audit_id}. You can return to ChatGPT and ask it to check the change.` : 'Cancelled. No changes were saved.'}</p>
        {Object.keys(preview.after).map((field) => <div className="chatgpt-connect-permissions" key={field}>
          <h2>{field === 'tools_required' ? 'Tools required' : field === 'relationship' ? 'Equipment relationship' : field === 'name' ? 'Name' : 'Description'}</h2>
          <div className="chatgpt-change-values">
            <div><h3>{details.status === 'applied' ? 'Previous value' : 'Current value'}</h3><p>{preview.before[field] || 'Empty'}</p></div>
            <div><h3>{details.status === 'applied' ? 'Saved value' : 'Proposed value'}</h3><p>{preview.after[field] || 'Empty'}</p></div>
          </div>
        </div>)}
        {details.status === 'pending' && <div className="chatgpt-connect-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => confirm(false)}>Cancel change</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirm(true)}>{busy ? 'Saving…' : 'Approve and save'}</button>
        </div>}
      </>}
      <footer className="chatgpt-connect-links">
        {preview && <a href={preview.record_url}>Open record in EquipMap</a>}
        <Link to="/">Back to EquipMap</Link>
      </footer>
    </section>
  </main>;
}

export default function ChatGPTConnect() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const handle = params.get('request');
  const change = params.get('change');

  if (loading) return <main className="chatgpt-connect-page"><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search } }} />;
  if (change) return <ChangeReview key={change} handle={change} user={user} />;
  return <ConnectionScreen key={handle || 'connections'} handle={handle} user={user} />;
}
