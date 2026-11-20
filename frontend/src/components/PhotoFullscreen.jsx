import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { photoUrl } from '../photoCache';
import './EntityPhoto.css';

export default function PhotoFullscreen({ path, name, offline, onClose, onImageError, returnFocus }) {
  const dialog = useRef(null);
  const transform = useRef(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [fitVersion, setFitVersion] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => {
      element.close();
      returnFocus?.focus();
    };
  }, [returnFocus]);

  return createPortal(
    <dialog ref={dialog} className="entity-photo-fullscreen" aria-label={`Fullscreen photo of ${name}`}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <div className="modal-card-header entity-photo-fullscreen-header">
        <h2>{name}</h2>
        <button type="button" className="btn btn-ghost" autoFocus aria-label="Close fullscreen photo" title="Close fullscreen photo (Escape)" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="entity-photo-fullscreen-tools" aria-label="Photo zoom controls">
        <button type="button" className="btn btn-secondary" disabled={!ready || scale <= 1} aria-label="Zoom out" title="Zoom out" onClick={() => transform.current?.zoomOut(0.3, 0)}><ZoomOut size={18} /></button>
        <output aria-label="Photo zoom level">{Math.round(scale * 100)}%</output>
        <button type="button" className="btn btn-secondary" disabled={!ready || scale >= 8} aria-label="Zoom in" title="Zoom in" onClick={() => transform.current?.zoomIn(0.3, 0)}><ZoomIn size={18} /></button>
        <button type="button" className="btn btn-secondary" disabled={!ready} onClick={() => { setFitVersion(version => version + 1); setScale(1); }}><RotateCcw size={16} />Fit image</button>
        <p>{offline ? 'Offline · saved thumbnail only' : 'Scroll or pinch to zoom. Drag to pan.'}</p>
      </div>
      <div className="entity-photo-fullscreen-body">
        {!ready && <span className="entity-photo-fullscreen-loading" role="status">Loading photo…</span>}
        <TransformWrapper key={fitVersion} ref={transform} minScale={1} maxScale={8} initialScale={1}
          panning={{ velocityDisabled: true }} doubleClick={{ mode: 'toggle' }}
          zoomAnimation={{ disabled: true }} alignmentAnimation={{ disabled: true }}
          onTransform={(_, state) => setScale(state.scale)}>
          <TransformComponent wrapperClass="entity-photo-zoom-wrapper" contentClass="entity-photo-zoom-content">
            <img className="entity-photo-fullscreen-image" src={photoUrl(path)} alt={name} draggable={false}
              decoding="async" onLoad={() => setReady(true)} onError={onImageError} />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </dialog>, document.body,
  );
}
