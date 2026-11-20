import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { api, getErrorMessage } from '../api';
import './PortableDownload.css';

export default function PortableDownload() {
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function download() {
    setError(''); setMessage(''); setPhase('Preparing download…');
    try {
      const { data: job } = await api.post('/api/data-manager/portable-exports');
      let status;
      while (mounted.current) {
        const { data } = await api.get(`/api/data-manager/portable-exports/${job.id}`);
        if (data.status === 'error') throw new Error(data.error);
        if (data.status === 'ready') { status = data; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!mounted.current) return;
      setPhase('Downloading ZIP…');
      const response = await api.get(`/api/data-manager/portable-exports/${job.id}/download`, { responseType: 'blob' });
      if (!mounted.current) return;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `EquipMap-Shared-${status.snapshot_utc.slice(0, 10)}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(`Download started. Data snapshot: ${new Date(status.snapshot_utc).toLocaleString()}.`);
    } catch (err) {
      if (mounted.current) setError(getErrorMessage(err, err.message || 'Could not prepare the download. Try again.'));
    } finally { if (mounted.current) setPhase(''); }
  }
  return <section className="portable-download-panel" aria-labelledby="portable-download-title">
    <h2 id="portable-download-title">Portable Shared version</h2>
    <p>Download the Windows app with the latest facility records, accounts and uploaded files. Extract the whole ZIP, then open EquipMap-Shared.exe.</p>
    <p>Contains private facility data. Save it in an approved location. Existing account passwords work in the downloaded copy.</p>
    <div className="portable-download-actions">
      <button type="button" className="btn btn-primary" disabled={Boolean(phase)} onClick={download}><Download size={16} aria-hidden="true" />{phase || 'Download portable Shared'}</button>
      {(phase || message) && <p role="status">{phase ? 'Preparing a fresh snapshot can take a moment. Keep this page open.' : message}</p>}
    </div>
    {error && <p className="text-danger" role="alert">{error}</p>}
  </section>;
}
