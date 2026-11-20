import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { Maximize, X } from 'lucide-react';
import { photoUrl } from '../photoCache';
import PhotoFullscreen from './PhotoFullscreen';
import './DataManager.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function UploadPreview({ file, returnFocus, onClose }) {
  const dialog = useRef(null);
  const media = useRef(null);
  const [width, setWidth] = useState(320);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [fullscreen, setFullscreen] = useState(null);
  const extension = file.path.split('.').pop().toLowerCase();
  const path = '/uploads/' + file.path.split('/').map(encodeURIComponent).join('/');
  const url = photoUrl(path);
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const observer = new ResizeObserver(entries => setWidth(Math.max(1, Math.floor(entries[0].contentRect.width))));
    observer.observe(media.current);
    return () => { observer.disconnect(); element.close(); returnFocus?.focus(); };
  }, [returnFocus]);

  return createPortal(<dialog ref={dialog} className={`modal-card glass-panel data-manager-preview${isImage ? ' data-manager-preview-photo' : ''}`} aria-label={`Preview ${file.path}`}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-card-header data-manager-preview-header"><h2>{file.path}</h2><button type="button" className="btn btn-secondary" autoFocus aria-label="Close upload preview" title="Close upload preview" onClick={onClose}><X size={18} /></button></div>
    <div className="modal-card-body data-manager-preview-body">
      <div ref={media} className="data-manager-preview-media">
        {error ? <p role="alert">This upload could not be previewed. It may have been removed or be unreadable.</p>
          : isImage ? <div className="entity-photo-frame data-manager-preview-image-frame"><img className="data-manager-preview-image" src={url} alt={file.path} decoding="async" onLoad={() => setLoaded(true)} onError={() => setError(true)} />
            {!loaded && <p role="status">Loading preview…</p>}
            {loaded && <button className="btn btn-secondary entity-photo-expand" type="button" aria-label="Full screen" title="Full screen" onClick={event => setFullscreen(event.currentTarget)}><Maximize size={16} /></button>}</div>
          : extension === 'pdf' ? <Document file={url} onLoadSuccess={({numPages}) => setPages(numPages)} onLoadError={() => setError(true)} loading={<p role="status">Loading PDF…</p>}>
            <Page pageNumber={page} width={width} renderTextLayer={false} renderAnnotationLayer={false} onRenderError={() => setError(true)} loading={<p role="status">Rendering page…</p>} />
          </Document>
          : extension === 'glb' ? <model-viewer src={url} alt={`3D preview of ${file.path}`} camera-controls onError={() => setError(true)} />
          : <p>Preview is unavailable for this file type.</p>}
      </div>
    </div>
    <div className="modal-card-footer data-manager-preview-footer">
      {extension === 'pdf' && pages > 0 && !error && <div className="data-manager-pagination"><button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous page</button><span>Page {page} of {pages}</span><button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next page</button></div>}
      <span>Read-only preview · {file.status === 'in_use' ? 'In use' : file.status === 'history' ? 'Retained for undo' : 'Not in use'}</span>
    </div>
    {fullscreen && <PhotoFullscreen path={path} name={file.path} returnFocus={fullscreen} onClose={() => setFullscreen(null)} onImageError={() => { setFullscreen(null); setError(true); }} />}
  </dialog>, document.body);
}
