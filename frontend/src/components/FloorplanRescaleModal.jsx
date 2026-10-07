import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Document as PdfDocument, Page as PdfPage, pdfjs } from 'react-pdf';
import { X, ZoomIn, ZoomOut, RefreshCw, Maximize2, Minus, Plus } from 'lucide-react';
import { API_URL } from '../api';
import './FloorplanRescaleModal.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;


export default function FloorplanRescaleModal(props) {
  if (!props.isOpen || !props.floorplan) return null;
  return <RescaleEditor key={`${props.floorplan.id}:${props.floorplan.previous_file_path || ''}`} {...props} />;
}

function RescaleEditor({
  isOpen,
  onClose,
  floorplan,
  onApplyRescale,
  isRescaling = false
}) {
  // Mobile detection & mobile tab switcher ('canvas' | 'controls')
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  const [mobileTab, setMobileTab] = useState('canvas'); // 'canvas' | 'controls'

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Numeric scale values (1.0 = 100%, 4.0 = 400%)
  const [scaleX, setScaleX] = useState(1.0);
  const [scaleY, setScaleY] = useState(1.0);
  const [lockAspect, setLockAspect] = useState(true);

  // String representations for smooth typing into exact input boxes
  const [scalePercentInput, setScalePercentInput] = useState('100');
  const [scaleXPercentInput, setScaleXPercentInput] = useState('100');
  const [scaleYPercentInput, setScaleYPercentInput] = useState('100');

  // Translation offsets in pixels
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetXInput, setOffsetXInput] = useState('0');
  const [offsetYInput, setOffsetYInput] = useState('0');

  // Ghost comparison overlay
  const [showGhost, setShowGhost] = useState(Boolean(floorplan?.previous_file_path));
  const [ghostOpacity, setGhostOpacity] = useState(0.5);
  const [ghostBlendMode, setGhostBlendMode] = useState('normal'); // 'difference' | 'normal'
  const [scaleGhostWithPins, setScaleGhostWithPins] = useState(true);

  // Detected natural dimensions of new and previous drawings
  const [newDims, setNewDims] = useState(null);
  const [prevDims, setPrevDims] = useState(null);
  const [autoScaleApplied, setAutoScaleApplied] = useState(false);

  // Canvas interaction mode
  const [dragMode, setDragMode] = useState('pan'); // 'pan' | 'offset'

  const transformComponentRef = useRef(null);
  const dialogRef = useRef(null);
  const [viewScale, setViewScale] = useState(isMobile ? 0.2 : 0.4);
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  const isDraggingOffsetRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, startOffsetX: 0, startOffsetY: 0 });

  // Extract existing items
  const equipment = useMemo(() => floorplan?.equipment || [], [floorplan]);
  const rooms = useMemo(() => floorplan?.rooms || [], [floorplan]);
  const tickets = useMemo(() => floorplan?.tickets || [], [floorplan]);
  const refPoints = useMemo(() => floorplan?.reference_points || [], [floorplan]);
  const totalItemCount = equipment.length + rooms.length + tickets.length + refPoints.length;

  // Scale sync helper
  const syncScaleState = useCallback((newSx, newSy) => {
    const sx = Math.max(0.01, Math.min(100.0, newSx));
    const sy = Math.max(0.01, Math.min(100.0, newSy));
    setScaleX(sx);
    setScaleY(sy);

    const sxPct = +(sx * 100).toFixed(2);
    const syPct = +(sy * 100).toFixed(2);

    setScalePercentInput(sxPct.toString());
    setScaleXPercentInput(sxPct.toString());
    setScaleYPercentInput(syPct.toString());
  }, []);

  // Compute auto-scale ratio from detected natural dimensions
  const autoScaleRatio = useMemo(() => {
    if (!newDims?.width || !prevDims?.width) return null;
    const rx = +(newDims.width / prevDims.width).toFixed(4);
    const ry = +(newDims.height / prevDims.height).toFixed(4);
    return { x: rx, y: ry };
  }, [newDims, prevDims]);

  // Automatically default to autoscaling when dimensions are detected!
  useEffect(() => {
    if (!autoScaleApplied && autoScaleRatio && autoScaleRatio.x > 0) {
      const isSignificant = Math.abs(autoScaleRatio.x - 1.0) > 0.02 || Math.abs(autoScaleRatio.y - 1.0) > 0.02;
      if (isSignificant) {
        // Auto-scale to match the images
        // Preserve the existing automatic dimension match after both drawings load.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        syncScaleState(autoScaleRatio.x, lockAspect ? autoScaleRatio.x : autoScaleRatio.y);
        setAutoScaleApplied(true);
      }
    }
  }, [autoScaleRatio, autoScaleApplied, lockAspect, syncScaleState]);

  // Percentage input handlers
  const handlePercentInputChange = (val, axis = 'both') => {
    if (axis === 'both') {
      setScalePercentInput(val);
      setScaleXPercentInput(val);
      setScaleYPercentInput(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        const s = Math.max(0.01, Math.min(100, parsed / 100));
        setScaleX(s);
        setScaleY(s);
      }
    } else if (axis === 'x') {
      setScaleXPercentInput(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        const s = Math.max(0.01, Math.min(100, parsed / 100));
        setScaleX(s);
      }
    } else {
      setScaleYPercentInput(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        const s = Math.max(0.01, Math.min(100, parsed / 100));
        setScaleY(s);
      }
    }
  };

  const handlePercentInputBlur = () => syncScaleState(scaleX, scaleY);

  const handleNudgeScale = (deltaPercent, axis = 'both') => {
    if (lockAspect || axis === 'both') {
      const newPct = Math.max(1, +(scaleX * 100 + deltaPercent).toFixed(1));
      syncScaleState(newPct / 100, newPct / 100);
    } else if (axis === 'x') {
      const newPct = Math.max(1, +(scaleX * 100 + deltaPercent).toFixed(1));
      syncScaleState(newPct / 100, scaleY);
    } else {
      const newPct = Math.max(1, +(scaleY * 100 + deltaPercent).toFixed(1));
      syncScaleState(scaleX, newPct / 100);
    }
  };

  // Offset sync helper
  const syncOffsetState = (newOx, newOy) => {
    const ox = Math.round(newOx);
    const oy = Math.round(newOy);
    setOffsetX(ox);
    setOffsetY(oy);
    setOffsetXInput(ox.toString());
    setOffsetYInput(oy.toString());
  };

  const handleOffsetInputChange = (val, axis) => {
    if (axis === 'x') {
      setOffsetXInput(val);
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) setOffsetX(parsed);
    } else {
      setOffsetYInput(val);
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) setOffsetY(parsed);
    }
  };

  const handleOffsetInputBlur = (axis) => {
    if (axis === 'x') {
      const parsed = parseInt(offsetXInput, 10);
      if (isNaN(parsed)) {
        setOffsetXInput(offsetX.toString());
      } else {
        setOffsetX(parsed);
        setOffsetXInput(parsed.toString());
      }
    } else {
      const parsed = parseInt(offsetYInput, 10);
      if (isNaN(parsed)) {
        setOffsetYInput(offsetY.toString());
      } else {
        setOffsetY(parsed);
        setOffsetYInput(parsed.toString());
      }
    }
  };

  const handleReset = () => {
    syncScaleState(1.0, 1.0);
    syncOffsetState(0, 0);
  };

  // Coordinate transform helper
  const transformCoord = useCallback((x, y) => {
    if (x == null || y == null) return null;
    return {
      x: +(x * scaleX + offsetX).toFixed(2),
      y: +(y * scaleY + offsetY).toFixed(2)
    };
  }, [scaleX, scaleY, offsetX, offsetY]);

  // Pointer/touch handlers for 'offset' mode (mobile & desktop friendly)
  const onPointerDown = (e) => {
    if (dragMode !== 'offset' || !e.isPrimary || e.button !== 0) return;
    isDraggingOffsetRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startOffsetX: offsetX,
      startOffsetY: offsetY
    };
    if (e.currentTarget?.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.stopPropagation();
  };

  const onPointerMove = (e) => {
    if (!isDraggingOffsetRef.current || dragMode !== 'offset') return;
    const currentZoom = transformComponentRef.current?.state?.scale || 1;
    const deltaX = (e.clientX - dragStartRef.current.x) / currentZoom;
    const deltaY = (e.clientY - dragStartRef.current.y) / currentZoom;
    const newOx = Math.round(dragStartRef.current.startOffsetX + deltaX);
    const newOy = Math.round(dragStartRef.current.startOffsetY + deltaY);
    setOffsetX(newOx);
    setOffsetY(newOy);
    setOffsetXInput(newOx.toString());
    setOffsetYInput(newOy.toString());
    e.stopPropagation();
  };

  const onPointerUp = (e) => {
    isDraggingOffsetRef.current = false;
    if (e.currentTarget?.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch { /* Capture may already be released. */ }
    }
  };

  const handleSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (isRescaling || !floorplan?.id || !onApplyRescale) return;
    onApplyRescale(floorplan.id, {
      scale_x: scaleX,
      scale_y: scaleY,
      offset_x: offsetX,
      offset_y: offsetY,
      origin_x: 0,
      origin_y: 0
    });
  };

  if (!isOpen || !floorplan) return null;

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape' && !isRescaling) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = elements[0]; const last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return (
    <div className="modal-overlay modal-backdrop-dark rescale-overlay" onClick={isRescaling ? undefined : onClose}>
      <div className="modal-content glass-panel rescale-dialog" role="dialog" aria-modal="true" aria-labelledby="rescale-title" ref={dialogRef} tabIndex={-1} onKeyDown={handleDialogKeyDown} onClick={e => e.stopPropagation()}>
        <div className="modal-card-header">
          <div className="rescale-heading">
            <h2 id="rescale-title">Rescale floorplan</h2>
            <p>{floorplan.name} · {totalItemCount} points</p>
          </div>
          <button type="button" className="btn btn-secondary rescale-icon" aria-label="Close rescale floorplan" disabled={isRescaling} onClick={onClose}><X size={18} /></button>
        </div>
        {isMobile && <div className="rescale-tabs" aria-label="Rescale view">
          <button type="button" className="btn btn-secondary" aria-pressed={mobileTab === 'canvas'} onClick={() => setMobileTab('canvas')}>Preview</button>
          <button type="button" className="btn btn-secondary" aria-pressed={mobileTab === 'controls'} onClick={() => setMobileTab('controls')}>Adjust points</button>
        </div>}
        <div className="rescale-body">
          <aside className="modal-card-body rescale-controls" hidden={isMobile && mobileTab !== 'controls'}>
            <p className="rescale-help">Scale changes point spacing. Zoom only changes your view.</p>
            {(lockAspect ? ['both'] : ['x', 'y']).map(axis => (
              <div key={axis} className="rescale-field">
                <label htmlFor={`rescale-${axis}`}>{axis === 'both' ? 'Point scale (%)' : axis === 'x' ? 'Horizontal scale (%)' : 'Vertical scale (%)'}</label>
                <div className="rescale-stepper">
                  <button type="button" className="btn btn-secondary rescale-icon" aria-label={`Decrease ${axis} scale`} onClick={() => handleNudgeScale(-0.1, axis)}><Minus size={16} /></button>
                  <input id={`rescale-${axis}`} type="number" min="1" max="10000" step="0.1" className="input-field" value={axis === 'both' ? scalePercentInput : axis === 'x' ? scaleXPercentInput : scaleYPercentInput}
                    onChange={e => handlePercentInputChange(e.target.value, axis)} onBlur={() => handlePercentInputBlur(axis)} />
                  <button type="button" className="btn btn-secondary rescale-icon" aria-label={`Increase ${axis} scale`} onClick={() => handleNudgeScale(0.1, axis)}><Plus size={16} /></button>
                </div>
              </div>
            ))}
            <label className="rescale-checkbox"><input type="checkbox" checked={lockAspect} onChange={e => { setLockAspect(e.target.checked); if (e.target.checked) syncScaleState(scaleX, scaleX); }} />Keep proportions</label>
            {autoScaleRatio && <button type="button" className="btn btn-secondary" onClick={() => syncScaleState(autoScaleRatio.x, lockAspect ? autoScaleRatio.x : autoScaleRatio.y)}>Match drawing dimensions</button>}
            <div className="rescale-offsets">
              {['x', 'y'].map(axis => <div key={axis} className="rescale-field">
                <label htmlFor={`rescale-offset-${axis}`}>{axis === 'x' ? 'Horizontal (px)' : 'Vertical (px)'}</label>
                <input id={`rescale-offset-${axis}`} type="number" step="1" className="input-field" value={axis === 'x' ? offsetXInput : offsetYInput} onChange={e => handleOffsetInputChange(e.target.value, axis)} onBlur={() => handleOffsetInputBlur(axis)} />
              </div>)}
            </div>
            <p className="rescale-help">Use Move points in the preview to drag points into position.</p>
            {floorplan.previous_file_path && <details className="rescale-comparison" open>
              <summary>Compare previous drawing</summary>
              <div className="rescale-comparison-fields">
                <label className="rescale-checkbox"><input type="checkbox" checked={showGhost} onChange={e => setShowGhost(e.target.checked)} />Show previous drawing</label>
                {showGhost && <>
                  <div className="rescale-field"><label htmlFor="rescale-opacity">Previous drawing opacity ({Math.round(ghostOpacity * 100)}%)</label><input id="rescale-opacity" type="range" min="0.05" max="0.95" step="0.05" value={ghostOpacity} onChange={e => setGhostOpacity(Number(e.target.value))} /></div>
                  <div className="rescale-field"><label htmlFor="rescale-blend">Comparison style</label><select id="rescale-blend" className="input-field" value={ghostBlendMode} onChange={e => setGhostBlendMode(e.target.value)}><option value="difference">Highlight differences</option><option value="normal">Overlay</option></select></div>
                  <label className="rescale-checkbox"><input type="checkbox" checked={scaleGhostWithPins} onChange={e => setScaleGhostWithPins(e.target.checked)} />Move and scale with points</label>
                </>}
              </div>
            </details>}
          </aside>
          <section className="rescale-preview" aria-label="Floorplan preview" hidden={isMobile && mobileTab !== 'canvas'}>
            <div className="rescale-toolbar">
              <div className="rescale-modes" aria-label="Drag behavior">
                <button type="button" className="btn btn-secondary" aria-pressed={dragMode === 'pan'} onClick={() => setDragMode('pan')}>Pan</button>
                <button type="button" className="btn btn-secondary" aria-pressed={dragMode === 'offset'} onClick={() => setDragMode('offset')}>Move points</button>
              </div>
              <div className="rescale-zoom" aria-label="Preview zoom">
                <button type="button" className="btn btn-secondary rescale-icon" aria-label="Zoom out" title="Zoom out" onClick={() => transformComponentRef.current?.zoomOut(0.05, 0)}><ZoomOut size={16} /></button>
                <output aria-label="Zoom level">{Math.round(viewScale * 100)}%</output>
                <button type="button" className="btn btn-secondary rescale-icon" aria-label="Zoom in" title="Zoom in" onClick={() => transformComponentRef.current?.zoomIn(0.05, 0)}><ZoomIn size={16} /></button>
                <button type="button" className="btn btn-secondary rescale-icon" aria-label="Reset view" title="Reset view" onClick={() => transformComponentRef.current?.resetTransform()}><Maximize2 size={16} /></button>
              </div>
            </div>
            <div className={`rescale-canvas rescale-canvas--${dragMode}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
              <TransformWrapper ref={transformComponentRef} initialScale={isMobile ? 0.2 : 0.4} minScale={0.01} maxScale={30} centerOnInit
                onTransform={(_, state) => setViewScale(state.scale)}
                panning={{ disabled: dragMode === 'offset', velocityDisabled: true }} pinch={{ disabled: dragMode === 'offset' }}
                wheel={{ step: viewScale * 0.0005 }} doubleClick={{ disabled: true }}>
                <TransformComponent wrapperClass="rescale-transform">
                  <div className="rescale-drawing">
                    {/* New Floorplan Drawing (Base Layer) */}
                    {floorplan.file_type === 'pdf' ? (
                      <PdfDocument
                        file={`${API_URL}${floorplan.file_path}`}
                        loading={<div className="rescale-loading">Loading PDF Drawing...</div>}
                      >
                        <PdfPage
                          pageNumber={1}
                          width={2000}
                          devicePixelRatio={isMobile ? 1.5 : 2}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          onLoadSuccess={(page) => {
                            const w = page.originalWidth || page.width || (page.view && page.view[2]);
                            const h = page.originalHeight || page.height || (page.view && page.view[3]);
                            if (w && h) setNewDims({ width: Math.round(w), height: Math.round(h) });
                          }}
                        />
                      </PdfDocument>
                    ) : (
                      <img
                        src={`${API_URL}${floorplan.file_path}`}
                        alt="Floorplan"
                        className="rescale-image"
                        draggable={false}
                        onLoad={(e) => {
                          const w = e.target.naturalWidth;
                          const h = e.target.naturalHeight;
                          if (w && h) setNewDims({ width: w, height: h });
                        }}
                      />
                    )}

                    {/* Previous Drawing (Ghost Comparison Layer) */}
                    {showGhost && floorplan.previous_file_path && (
                      <div
                        className="rescale-ghost"
                        // Multiply preserves the current drawing beneath the previous page's white background.
                        style={{ opacity: ghostOpacity, mixBlendMode: ghostBlendMode === 'normal' ? 'multiply' : 'difference',
                          transform: scaleGhostWithPins ? `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})` : 'none' }}
                      >
                        {floorplan.previous_file_path.toLowerCase().endsWith('.pdf') ? (
                          <PdfDocument file={`${API_URL}${floorplan.previous_file_path}`}>
                            <PdfPage
                              pageNumber={1}
                              width={2000}
                              devicePixelRatio={isMobile ? 1.5 : 2}
                              renderTextLayer={false}
                              renderAnnotationLayer={false}
                              onLoadSuccess={(page) => {
                                const w = page.originalWidth || page.width || (page.view && page.view[2]);
                                const h = page.originalHeight || page.height || (page.view && page.view[3]);
                                if (w && h) setPrevDims({ width: Math.round(w), height: Math.round(h) });
                              }}
                            />
                          </PdfDocument>
                        ) : (
                          <img
                            src={`${API_URL}${floorplan.previous_file_path}`}
                            alt="Previous Drawing"
                            className="rescale-image"
                            draggable={false}
                            onLoad={(e) => {
                              const w = e.target.naturalWidth;
                              const h = e.target.naturalHeight;
                              if (w && h) setPrevDims({ width: w, height: h });
                            }}
                          />
                        )}
                      </div>
                    )}

                    <div className="rescale-points">
                      {[
                        ...equipment.map(item => ({ ...item, kind: 'equipment' })),
                        ...rooms.map(item => ({ ...item, kind: 'room' })),
                        ...tickets.map(item => ({ ...item, kind: 'ticket' })),
                        ...refPoints.map(item => ({ ...item, kind: 'reference' })),
                      ].map(item => {
                        const coord = transformCoord(item.x_coordinate, item.y_coordinate);
                        if (!coord) return null;
                        return <span key={`${item.kind}-${item.id}`} className={`rescale-point rescale-point--${item.kind}`} style={{ left: coord.x, top: coord.y, ...(item.color ? { backgroundColor: item.color } : {}) }} />;
                      })}
                    </div>
                  </div>
                </TransformComponent>
              </TransformWrapper>
            </div>
          </section>
        </div>
        <div className="modal-card-footer">
          <button type="button" className="btn btn-secondary rescale-reset" disabled={isRescaling} onClick={handleReset}>Reset changes</button>
          <button type="button" className="btn btn-secondary" disabled={isRescaling} onClick={onClose}>Cancel</button>
          <button type="button" className="btn rescale-apply" disabled={isRescaling} onClick={handleSubmit}>{isRescaling && <RefreshCw size={14} className="spinning" />}{isRescaling ? 'Saving...' : 'Apply rescale'}</button>
        </div>
      </div>
    </div>
  );
}
