import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TiledFloorplan } from './TiledFloorplan';
import { BoundedImageFloorplan } from './BoundedImageFloorplan';
import { BASE_URL } from '../api';
import DrawingRegionEditor from './DrawingRegionEditor';
import { fitDrawingWarp } from '../drawingWarp';
import WarpedDrawing from './WarpedDrawing';

function MatchMarkers({ matches, side, onRemove }) {
  const [selected, setSelected] = useState(null);
  return matches.map((pair, index) => {
    const point = pair[side];
    const deleting = selected === pair;
    const label = `${deleting ? 'Delete' : 'Select'} match ${index + 1}`;
    return <button key={`${point.x}:${point.y}`} type="button" aria-label={label} title={label}
      className={`drawing-match-marker ${side === 'source' ? 'drawing-match-marker-on-sheet' : ''} ${deleting ? 'drawing-match-marker-delete' : ''}`}
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
      onClick={event => {
        event.stopPropagation();
        if (!deleting) { setSelected(pair); return; }
        document.querySelector('[aria-label="Adjust drawing"] [aria-pressed="true"]:not([disabled]), [aria-label="Expand drawing controls"]')?.focus();
        setSelected(null);
        onRemove(index);
      }}
      onKeyDown={event => { if (event.key === 'Escape' && deleting) { event.stopPropagation(); setSelected(null); } }}>
      <span>{deleting ? <X size={16} aria-hidden="true" /> : index + 1}</span>
    </button>;
  });
}

function DrawingSheet({ item, transformRef, size, opacity, comparison, editing, model }) {
  const [status, setStatus] = useState('loading');
  const { reportDrawingAssetStatus } = model;
  useEffect(() => {
    reportDrawingAssetStatus(item.id, status);
  }, [item.id, status, reportDrawingAssetStatus]);
  useEffect(() => () => reportDrawingAssetStatus(item.id, undefined), [item.id, reportDrawingAssetStatus]);
  const drag = useRef(null);
  const source = useRef(null);
  const imageRef = useRef(null);
  useEffect(() => {
    if (status !== 'loading') return;
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth) {
      const frame = requestAnimationFrame(() => setStatus('ready'));
      return () => cancelAnimationFrame(frame);
    }
    const timeout = setTimeout(() => setStatus('error'), 20_000);
    return () => clearTimeout(timeout);
  }, [status]);
  const placement = item.placement;
  const overlay = { tx: placement.x / 100 * size.width, ty: placement.y / 100 * size.height,
    scale: placement.scale, rotation: placement.rotation };
  const crop = placement.crop;
  const failed = () => { setStatus('error'); model.setAssetError(`Could not load ${item.title}. Check the file and PDF page, then retry.`); };
  // These values are drawing geometry in the existing 2000-unit map coordinate space.
  const geometry = { left: `${placement.x}%`, top: `${placement.y}%`,
    transform: `rotate(${placement.rotation}deg) scale(${placement.scale})`, '--drawing-local-scale': placement.scale, '--drawing-rotation': `${placement.rotation}deg` };
  const cropEditing = editing && model.tool === 'crop';
  const matching = editing && model.tool === 'match';
  const pickingSource = matching && model.matchPhase === 'source';
  const pickingTarget = matching && model.matchPhase === 'target';
  const warp = useMemo(() => item.file_type === 'image' ? fitDrawingWarp(placement.matches || []) : null, [item.file_type, placement.matches]);
  const showWarp = Boolean(warp && !cropEditing && (!matching || model.matchPhase === 'preview'));
  const contentGeometry = { opacity: pickingSource ? 1 : opacity / 100,
    clipPath: cropEditing || pickingSource ? undefined : `inset(${crop.y}% ${100 - crop.x - crop.width}% ${100 - crop.y - crop.height}% ${crop.x}%)` };
  const handlePointerDown = event => {
    if (!editing || model.tool !== 'move') return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.closest('.drawing-map-surface').getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: placement.x, top: placement.y, width: bounds.width, height: bounds.height };
  };
  const handlePointerMove = event => {
    if (!drag.current) return;
    event.stopPropagation();
    const start = drag.current;
    model.updatePlacement({ x: Math.max(-200, Math.min(200, start.left + (event.clientX - start.x) / start.width * 100)),
      y: Math.max(-200, Math.min(200, start.top + (event.clientY - start.y) / start.height * 100)) });
  };
  return <>
    <div className={`drawing-map-sheet ${editing && model.tool === 'move' ? 'drawing-map-sheet-moving' : ''} ${pickingSource ? 'drawing-match-picking' : ''} ${comparison ? 'drawing-map-sheet-comparison' : ''}`} style={geometry} data-drawing-status={status}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onClick={event => { if (editing && model.tool === 'move') event.stopPropagation(); }}>
      <div ref={source} className={`drawing-map-sheet-content ${showWarp || pickingTarget ? 'drawing-match-source-hidden' : ''} ${pickingSource ? 'drawing-match-source' : ''}`} style={contentGeometry}>
        {item.file_type === 'pdf' ? <TiledFloorplan url={`${BASE_URL}${item.file_path}`} pageNumber={item.page_number} transformRef={transformRef} overlay={overlay} onLoad={() => setStatus('ready')} onError={failed} />
          : item.file_type === 'image' ? <BoundedImageFloorplan url={`${BASE_URL}${item.file_path}`} onLoad={() => setStatus('ready')} onError={failed} />
          : <img ref={imageRef} className="drawing-map-image" src={`${BASE_URL}${item.file_path}`} alt={item.title} draggable="false" onLoad={() => setStatus('ready')} onError={failed} />}
      </div>
      {pickingSource && <MatchMarkers matches={model.matches} side="source" onRemove={model.removeMatch} />}
      {cropEditing && status === 'ready' && <DrawingRegionEditor kind="crop" region={crop} onChange={next => model.updatePlacement({ crop: next })} />}
    </div>
    {showWarp && status === 'ready' && <WarpedDrawing source={source} warp={warp} matches={placement.matches} crop={crop} size={size}
      opacity={opacity} url={`${BASE_URL}${item.file_path}`} title={item.title} transformRef={transformRef} />}
  </>;
}

export default function FloorplanDrawingSurface({ model, transformRef }) {
  const surface = useRef(null);
  const [size, setSize] = useState({ width: 2000, height: 1000 });
  useEffect(() => {
    const element = surface.current;
    const observer = new ResizeObserver(() => setSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const drawings = model.editing ? [model.editing] : [model.selected, model.comparison].filter(item => item && model.valid(item));
  const coverage = model.editing?.placement.coverage || (model.open && model.selected && model.valid(model.selected) ? model.selected.placement.coverage : null);
  return <div ref={surface} className={`drawing-map-surface ${model.editing ? 'drawing-map-surface-editing' : ''}`} aria-label="Drawing overlays">
    {drawings.map((item, index) => {
      const box = !model.editing && item.placement.coverage;
      return <div className={`drawing-map-clip ${model.editing ? 'drawing-map-clip-editing' : ''}`} key={`${item.id}-${item.page_number}-${model.assetAttempt}`} style={box ? { clipPath: `inset(${box.y}% ${100 - box.x - box.width}% ${100 - box.y - box.height}% ${box.x}%)` } : undefined}>
        <DrawingSheet item={item} transformRef={transformRef} size={size} opacity={index > 0 ? 100 - model.opacity : model.opacity} comparison={index > 0} editing={!!model.editing} model={model} />
      </div>;
    })}
    {model.open && !model.editing && model.available.map(item => {
      const box = item.placement.coverage;
      return <div key={item.id} className={`drawing-map-coverage ${model.selected?.id === item.id ? 'drawing-map-coverage-selected' : ''} ${model.comparison?.id === item.id ? 'drawing-map-coverage-comparison' : ''}`}
        style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}>
        <button type="button" aria-label={`Show drawing ${item.title}`} aria-pressed={model.selected?.id === item.id} onClick={event => { event.stopPropagation(); model.select(item); }}>{item.sheet_number || item.title}</button>
      </div>;
    })}
    {coverage && (!model.editing || !['crop', 'match'].includes(model.tool)) && <DrawingRegionEditor kind="coverage" region={coverage} interactive={!!model.editing && model.tool === 'coverage'} onChange={next => model.updatePlacement({ coverage: next })} />}
    {model.editing && model.tool === 'match' && model.matchPhase !== 'source' && <MatchMarkers matches={model.matches} side="target" onRemove={model.removeMatch} />}
  </div>;
}
