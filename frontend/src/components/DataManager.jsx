import UploadUsage from './UploadUsage';
import SortableTableHeader from './SortableTableHeader';
import TablePagination from './TablePagination';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { api, getErrorMessage } from '../api';
import './DataManager.css';
import UploadPreview from './UploadPreview';
import PortableDownload from './PortableDownload';

const labels = { unused: 'Ready to delete', in_use: 'In use', history: 'Retained for undo' };
const bytes = value => value < 1024 ? `${value} B` : `${(value / 1024 ** (value < 1048576 ? 1 : 2)).toFixed(1)} ${value < 1048576 ? 'KiB' : 'MiB'}`;

export default function DataManager() {
  const [files, setFiles] = useState(null);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('not_in_use');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [usage, setUsage] = useState(null);
  const scan = useCallback(async () => {
    setBusy(true);
    setError('');
    setSelected([]);
    try {
      const result = await api.get('/api/data-manager/uploads');
      setFiles(result.data.files);
      setPage(1);
    } catch (err) { setError(getErrorMessage(err, 'Could not load uploads. Try again.')); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { queueMicrotask(scan); }, [scan]);
  const sortColumn = field => {
    setSortDirection(sortBy === field ? (sortDirection === 'asc' ? 'desc' : 'asc') : field === 'name' ? 'asc' : 'desc');
    setSortBy(field);
    setPage(1);
    setSelected([]);
  };
  const matching = useMemo(() => (files || []).filter(file =>
    (filter === 'all' || (filter === 'not_in_use' ? file.status !== 'in_use' : file.status === filter)) &&
    `${file.filename || ''} ${file.path}`.toLowerCase().includes(search.trim().toLowerCase())
  ).sort((a, b) => {
    const comparison = sortBy === 'name' ? (a.filename || a.path).localeCompare(b.filename || b.path, undefined, { numeric: true, sensitivity: 'base' })
      : sortBy === 'size' ? a.bytes - b.bytes : a.modified - b.modified;
    return (sortDirection === 'asc' ? 1 : -1) * comparison || a.path.localeCompare(b.path);
  }), [files, filter, search, sortBy, sortDirection]);
  const currentPage = pageSize === 'all' ? 1 : Math.min(page, Math.max(1, Math.ceil(matching.length / pageSize)));
  const visible = pageSize === 'all' ? matching : matching.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const canSelect = file => file.status === 'unused' || file.status === 'history';
  const eligible = visible.filter(canSelect);
  const chosen = (files || []).filter(file => selected.includes(file.path));
  async function remove() {
    const total = chosen.reduce((sum, file) => sum + file.bytes, 0);
    const undoWarning = ' Any undo actions requiring these files will become permanently unavailable. Audit records will remain.';
    if (!window.confirm(`Permanently delete ${chosen.length} uploads (${bytes(total)})?${undoWarning} This cannot be undone. Cached CDN/browser copies may remain until they expire.`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post('/api/data-manager/uploads/delete', {
        discard_undo: true,
        files: chosen.map(({ path, fingerprint }) => ({ path, fingerprint })),
      });
      setMessage(`Deleted ${result.data.deleted} files and freed ${bytes(result.data.bytes_freed)}.${result.data.disabled_undo_count ? ` Undo disabled for ${result.data.disabled_undo_count} audit entries; their records were kept.` : ''}${result.data.failed.length ? ` ${result.data.failed.length} files could not be deleted; scan again to retry.` : ''}`);
      await scan();
    } catch (err) { setError(getErrorMessage(err, 'Could not delete uploads. Refresh before retrying.')); setSelected([]); }
    finally { setBusy(false); }
  }
  return <section className="data-manager" aria-labelledby="data-manager-title">
    {import.meta.env.VITE_PORTABLE !== 'true' && <PortableDownload />}
    <div className="data-manager-heading">
      <div><h2 id="data-manager-title">Upload storage</h2><p>Review uploads no longer in use, including files retained for undo. Only files still in active use are protected.</p></div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={scan}><RefreshCw size={16} />{busy ? 'Working…' : 'Refresh uploads'}</button>
    </div>
    {files && <div className="data-manager-summary">{Object.entries(labels).map(([status, label]) => {
      const group = files.filter(file => file.status === status);
      return <div key={status}><span>{label}</span><strong>{group.length} files · {bytes(group.reduce((sum, file) => sum + file.bytes, 0))}</strong></div>;
    })}</div>}
    <p className="data-manager-note">Removed photos appear in “Not in use”, including those retained for undo. Deleting a retained file disables affected undo actions; audit records remain.</p>
    <div className="data-manager-toolbar">
      <label htmlFor="upload-filter">Show files<select id="upload-filter" className="input-field" disabled={busy} value={filter} onChange={event => { setFilter(event.target.value); setPage(1); setSelected([]); }}>
        <option value="not_in_use">Not in use</option><option value="all">All uploads</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label htmlFor="upload-search" className="data-manager-search">Search filenames<input id="upload-search" type="search" className="input-field" value={search} disabled={busy} placeholder="Filename or path" onChange={event => { setSearch(event.target.value); setPage(1); setSelected([]); }} /></label>
      <button type="button" className="btn btn-danger" disabled={busy || !chosen.length} onClick={remove}><Trash2 size={16} />Delete selected ({chosen.length})</button>
    </div>

    {error && <p className="text-danger" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {busy && !files ? <p role="status">Loading uploads…</p> : files && <>
      {!matching.length ? <p className="data-manager-empty">{search.trim() ? 'No files match this search and filter.' : filter === 'not_in_use' ? 'No uploads are detached from active records.' : filter === 'unused' ? 'No uploads are ready for deletion.' : 'No files match this filter.'}</p> : <div className="data-manager-table" tabIndex={0} role="region" aria-label="Upload files">
        <table className="list-table"><thead><tr>
          <th><input type="checkbox" aria-label="Select eligible files on this page" disabled={busy || !eligible.length} checked={eligible.length > 0 && eligible.every(file => selected.includes(file.path))} onChange={event => setSelected(event.target.checked ? eligible.map(file => file.path) : [])} /></th>
          <SortableTableHeader field="name" sortBy={sortBy} direction={sortDirection} onSort={sortColumn} disabled={busy}>File</SortableTableHeader><SortableTableHeader field="size" sortBy={sortBy} direction={sortDirection} onSort={sortColumn} disabled={busy}>Size</SortableTableHeader><th>Status</th><SortableTableHeader field="date" sortBy={sortBy} direction={sortDirection} onSort={sortColumn} disabled={busy}>Modified</SortableTableHeader>
        </tr></thead><tbody>{visible.map(file => <tr key={file.path}>
          <td><input type="checkbox" aria-label={`Select ${file.filename || file.path}`} title={canSelect(file) ? `Select ${file.filename || file.path}` : file.status === 'in_use' ? 'This file is still in use.' : 'This file cannot be selected.'} disabled={busy || !canSelect(file)} checked={selected.includes(file.path)} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.path] : previous.filter(path => path !== file.path))} /></td>
          <td className="data-manager-path"><button type="button" className="data-manager-file-link" title={`Preview ${file.filename || file.path}`} onClick={event => setPreview({file, trigger: event.currentTarget})}>{file.filename || file.path}</button>{file.filename && <div className="data-manager-stored-path">{file.path}</div>}</td><td>{bytes(file.bytes)}</td><td>{file.status === 'in_use' ? <button type="button" className="data-manager-file-link" aria-label={`Show usage of ${file.path}`} onClick={event => setUsage({ file, trigger: event.currentTarget })}>In use</button> : labels[file.status]}</td><td>{new Date(file.modified * 1000).toLocaleString()}</td>
        </tr>)}</tbody></table>
      </div>}
      <TablePagination total={matching.length} page={currentPage} pageSize={pageSize} disabled={busy}
        onPageChange={value => { setPage(value); setSelected([]); }}
        onPageSizeChange={value => { setPageSize(value); setPage(1); setSelected([]); }} />
    </>}
    {usage && <UploadUsage key={usage.file.path} file={usage.file} returnFocus={usage.trigger} onClose={() => setUsage(null)} />}
    {preview && <UploadPreview key={preview.file.path} file={preview.file} returnFocus={preview.trigger} onClose={() => setPreview(null)} />}
  </section>;
}
