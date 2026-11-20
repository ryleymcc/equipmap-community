import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Layers, LoaderCircle, Plus, X } from 'lucide-react';
import { BASE_URL, getErrorMessage } from '../api';
import FloorplanDrawingForm from './FloorplanDrawingForm';
import DrawingMatchControls, { DrawingMatchStatus } from './DrawingMatchControls';
import './FloorplanLayers.css';

const MODE_TITLES = { move: 'Move drawing', pan: 'Pan map', crop: 'Crop points', coverage: 'Coverage points', match: 'Match points' };

function DrawingLoadingStatus({ drawing }) {
  return <div role="status" className="drawing-load-status drawing-note">
    {drawing && <><LoaderCircle size={16} className="spinning" aria-hidden="true" /><span>Loading {drawing.title}…</span></>}
  </div>;
}

function DrawingLoadError({ model }) {
  if (!model.failedDrawing) return null;
  return <div className="drawing-load-error">
    <p className="drawing-note" role="alert">{model.assetError || `${model.failedDrawing.title} is taking too long to load.`}</p>
    <button type="button" className="btn btn-secondary" onClick={model.retryAssets}>Retry drawing</button>
  </div>;
}

function DrawingRegionFields({ value, onChange, prefix }) {
  const region = value || { x: 0, y: 0, width: 100, height: 100 };
  const crop = prefix === 'crop';
  const margins = { left: region.x, top: region.y, right: Math.max(0, 100 - region.x - region.width), bottom: Math.max(0, 100 - region.y - region.height) };
  const coordinates = { x1: region.x, y1: region.y, x2: region.x + region.width, y2: region.y + region.height };
  const fields = crop ? [['left', 'Left (%)'], ['top', 'Top (%)'], ['right', 'Right (%)'], ['bottom', 'Bottom (%)']]
    : [['x1', 'X1 (%)'], ['y1', 'Y1 (%)'], ['x2', 'X2 (%)'], ['y2', 'Y2 (%)']];
  return <div className="drawing-form-grid">{fields.map(([key, label]) => <div className="equip-field" key={key}>
    <label htmlFor={`drawing-${prefix}-${key}`}>{prefix === 'coverage' ? 'Coverage ' : 'Crop '}{crop ? label.toLowerCase() : label}</label>
    <input id={`drawing-${prefix}-${key}`} className="input-field" type="number" min={0} max={crop ? 99.9 : 100} step={0.1} value={Number((crop ? margins[key] : coordinates[key]).toFixed(4))}
      onChange={event => { const number = Number(event.target.value); if (!Number.isFinite(number) || (crop && number < 0)) return;
        const edges = { ...margins, [key]: number };
        const points = { ...coordinates, [key]: number };
        const next = crop ? { x: edges.left, y: edges.top, width: Number((100 - edges.left - edges.right).toFixed(4)), height: Number((100 - edges.top - edges.bottom).toFixed(4)) } : { x: points.x1, y: points.y1, width: Number((points.x2 - points.x1).toFixed(4)), height: Number((points.y2 - points.y1).toFixed(4)) };
        if (next.x >= 0 && next.y >= 0 && next.width > 0 && next.height > 0 && next.x + next.width <= 100 && next.y + next.height <= 100) onChange(next);
      }} />
  </div>)}</div>;
}

export default function FloorplanLayers({ model, isEditor, onOpen }) {
  const trigger = useRef(null);
  const panel = useRef(null);
  const [form, setForm] = useState(null);
  const [returnFocus, setReturnFocus] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const { open, selected, editing } = model;
  const [selectionKey, setSelectionKey] = useState('');
  const nextSelectionKey = `${selected?.id}-${editing?.id}-${open}`;
  if (selectionKey !== nextSelectionKey) { setSelectionKey(nextSelectionKey); setError(''); setDeleting(false); setControlsCollapsed(false); if (!open) setForm(null); }
  useEffect(() => {
    if (open) panel.current?.querySelector('button')?.focus();
  }, [open, editing?.id]);
  const close = () => { model.cancelAlignment(); model.setOpen(false); trigger.current?.focus(); };
  const action = async callback => {
    setBusy(true); setError('');
    try { await callback(); setDeleting(false); }
    catch (err) { setError(getErrorMessage(err, 'Could not save the drawing. Try again.')); }
    finally { setBusy(false); }
  };
  const showForm = (event, value) => { setReturnFocus(event.currentTarget); setForm(value); };
  const focusRegion = kind => {
    const region = kind === 'crop' ? editing?.placement.crop : editing?.placement.coverage;
    if (editing && window.matchMedia('(max-width: 700px) and (max-height: 600px)').matches) {
      setControlsCollapsed(true);
      requestAnimationFrame(() => { model.showRegion(kind, region); panel.current?.querySelector('[aria-label="Expand drawing controls"]')?.focus(); });
    } else model.showRegion(kind, region);
  };
  const editRegion = kind => {
    model.editRegion(kind);
    focusRegion(kind);
  };
  const overlaps = selected && model.valid(selected) ? model.available.filter(item => {
    if (item.id === selected.id) return false;
    const a = item.placement.coverage, b = selected.placement.coverage;
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }) : [];
  return <>
    <button ref={trigger} type="button" className="trigger-btn drawing-layers-trigger" aria-label="Layers" title="Drawing layers" aria-expanded={open} aria-controls="drawing-layers-panel"
      onClick={() => { if (open) close(); else { onOpen(); model.setOpen(true); } }}><Layers size={20} aria-hidden="true" /></button>
    {open && <section ref={panel} id="drawing-layers-panel" className={`drawing-layers-panel glass-panel ${editing && controlsCollapsed ? 'drawing-controls-collapsed' : ''}`} aria-label="Drawing layers"
      onKeyDown={event => { if (event.key === 'Escape' && !form && !busy) { event.stopPropagation(); close(); } }}>
      <header className="drawing-layers-header"><h2>{editing && controlsCollapsed ? MODE_TITLES[model.tool] : editing ? 'Align drawing' : 'Drawing layers'}</h2><div className="drawing-actions">{editing && <button type="button" className="btn btn-secondary" aria-label={controlsCollapsed ? 'Expand drawing controls' : 'Collapse drawing controls'} title={controlsCollapsed ? 'Expand drawing controls' : 'Collapse drawing controls'} aria-expanded={!controlsCollapsed} onClick={() => {
        setControlsCollapsed(!controlsCollapsed);
        if (!controlsCollapsed && ['crop', 'coverage'].includes(model.tool)) {
          requestAnimationFrame(() => model.showRegion(model.tool));
        }
      }}>{controlsCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}<button type="button" className="btn btn-secondary" title="Close drawing layers" aria-label="Close drawing layers" disabled={busy} onClick={close}><X size={18} /></button></div></header>
      {editing && controlsCollapsed && model.tool === 'match' && <div className="drawing-match-step"><DrawingMatchStatus model={model} />{model.matchError && <p className="drawing-sheet-status" role="alert">{model.matchError}</p>}</div>}
      <DrawingLoadingStatus drawing={model.loadingDrawing} />
      <DrawingLoadError model={model} />
      <div className="drawing-layers-body" hidden={!!editing && controlsCollapsed}>
        {editing ? <>
          <strong>{editing.title}</strong>
          <div className="drawing-actions" role="group" aria-label="Adjust drawing"><button type="button" className="btn btn-secondary drawing-mode-button" aria-pressed={model.tool === 'pan'} onClick={() => model.setTool('pan')}>Pan map</button><button type="button" className="btn btn-secondary drawing-mode-button" aria-pressed={model.tool === 'move'} disabled={model.matchValid} onClick={() => model.setTool('move')}>Move drawing</button><button type="button" className="btn btn-secondary drawing-mode-button" aria-pressed={model.tool === 'coverage'} onClick={() => editRegion('coverage')}>Coverage points</button><button type="button" className="btn btn-secondary drawing-mode-button" aria-pressed={model.tool === 'crop'} onClick={() => editRegion('crop')}>Crop points</button>
            {editing.file_type === 'image' && <button type="button" className="btn btn-secondary drawing-mode-button" aria-pressed={model.tool === 'match'} onClick={() => {
              model.startMatching();
              model.showRegion('crop', { x: 0, y: 0, width: 100, height: 100 });
            }}>Match points</button>}
          </div>
          {model.tool === 'match' ? <DrawingMatchControls model={model} /> : <>
          <p className="drawing-note" role="status">{model.tool === 'pan' ? (model.matchValid ? 'Drag anywhere to pan. Use Match points to adjust the alignment.' : 'Drag anywhere on the map to pan. Use Move drawing to reposition the sheet.') : model.tool === 'coverage' ? 'Drag the corner points to choose where this drawing appears on the floorplan.' : model.tool === 'crop' ? 'Drag the corner points to trim the drawing. Shaded margins are hidden.' : 'Drag the drawing to move it. Match walls or columns with the floorplan.'}</p>
          <div className="drawing-form-grid">
            {[['x', 'Horizontal offset (%)', -200, 200, 0.1], ['y', 'Vertical offset (%)', -200, 200, 0.1], ['scale', 'Scale (%)', 1, 1000, 0.1], ['rotation', 'Rotation (°)', -180, 180, 0.1]].map(([key, label, min, max, step]) => <div className="equip-field" key={key}><label htmlFor={`drawing-align-${key}`}>{label}</label><input id={`drawing-align-${key}`} className="input-field" type="number" min={min} max={max} step={step}
              disabled={model.matchValid && model.tool !== 'crop'} value={Number((editing.placement[key] * (key === 'scale' ? 100 : 1)).toFixed(2))}
              onChange={event => { const value = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(value) && value >= min && value <= max) model.updatePlacement({ [key]: value / (key === 'scale' ? 100 : 1) }); }} /></div>)}
          </div>
          <div className="drawing-actions"><button className="btn btn-secondary" type="button" onClick={() => focusRegion(model.tool === 'crop' ? 'crop' : 'coverage')}>Show {model.tool === 'crop' ? 'crop' : 'coverage'}</button><button className="btn btn-secondary" type="button" onClick={model.wholeFloor}>Use whole floor</button></div>
          {model.tool !== 'move' && <p className="drawing-note">Points 1 and 3 are the top left and bottom right. Arrow keys fine-tune a focused point; Shift moves farther.</p>}
          <details className="drawing-crop" open={model.tool === 'coverage'}><summary>Coverage coordinates</summary><DrawingRegionFields prefix="coverage" value={editing.placement.coverage} onChange={coverage => model.updatePlacement({ coverage })} /></details>
          <details className="drawing-crop" open={model.tool === 'crop'}><summary>Crop drawing margins</summary><p className="drawing-note">Point 1: X {editing.placement.crop.x.toFixed(1)}%, Y {editing.placement.crop.y.toFixed(1)}% · Point 3: X {(editing.placement.crop.x + editing.placement.crop.width).toFixed(1)}%, Y {(editing.placement.crop.y + editing.placement.crop.height).toFixed(1)}%</p><DrawingRegionFields prefix="crop" value={editing.placement.crop} onChange={crop => model.updatePlacement({ crop })} /></details>
          </>}
        </> : <>
          {model.disciplines.size > 0 && <div className="equip-field"><label htmlFor="drawing-discipline-filter">Discipline</label><select id="drawing-discipline-filter" className="input-field" value={model.discipline} onChange={event => model.changeDiscipline(event.target.value)}>{[...model.disciplines].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}
          {model.loading ? <p role="status">Loading drawings…</p> : model.error ? <div role="alert"><p>{model.error}</p><button type="button" className="btn btn-secondary" onClick={model.retry}>Retry</button></div> : <>
            {model.point && <div className="drawing-location-filter"><p role="status">{model.candidates.length ? `${model.candidates.length} drawing${model.candidates.length === 1 ? '' : 's'} cover this location` : 'No mapped drawings cover this location.'}</p><button type="button" className="btn btn-secondary" onClick={() => model.setPoint(null)}>Show all sheets</button></div>}
            {!model.point && !model.items.length && <p className="drawing-note">No drawings for this floor.</p>}
            <div className="drawing-sheet-list">{model.candidates.map(item => <button className={`drawing-sheet-row ${selected?.id === item.id ? 'drawing-sheet-row-selected' : ''}`} type="button" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => model.select(item)}>
              <span>{item.title}</span><span className="drawing-note">{[item.sheet_number, item.project, item.drawing_date, item.revision && `Rev ${item.revision}`].filter(Boolean).join(' · ') || item.filename}</span>
              {!model.valid(item) && <span className="drawing-sheet-status">{item.placement ? 'Alignment needs review' : 'Reference only · Not aligned'}</span>}
            </button>)}</div>
            {selected && <div className="drawing-selection">
              <strong>{selected.title}</strong><p className="drawing-note">{selected.filename}{selected.file_type === 'pdf' ? ` · Page ${selected.page_number}` : ''}</p>
              <a className="btn btn-secondary" href={`${BASE_URL}${selected.file_path}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Open original</a>
              {!model.valid(selected) && <p className="drawing-note">{selected.placement ? 'The base floorplan changed. Review alignment before displaying this sheet.' : 'Align this sheet to display it on the floorplan.'}</p>}
              {model.valid(selected) && <><p className="drawing-note">Coverage is the outlined area where this drawing appears. Outside it, the base floorplan remains visible.</p><button className="btn btn-secondary" type="button" onClick={() => model.showRegion('coverage')}>Show coverage</button></>}
              {!!overlaps.length && <><p className="drawing-overlap"><AlertTriangle size={16} />{overlaps.length} overlapping sheet{overlaps.length === 1 ? '' : 's'}</p><div className="equip-field"><label htmlFor="drawing-compare">Compare with</label><select id="drawing-compare" className="input-field" value={model.compareId || ''} onChange={event => model.setCompareId(Number(event.target.value) || null)}><option value="">Show selected sheet only</option>{overlaps.map(item => <option key={item.id} value={item.id}>{item.sheet_number || item.title} · {item.drawing_date || 'Undated'}</option>)}</select></div><p className="drawing-note">Dates do not establish which drawing applies. Check the project scope and source.</p></>}
              {isEditor && <div className="drawing-actions"><button type="button" className="btn btn-secondary" onClick={() => model.beginAlignment(selected)}>Align & coverage</button><button type="button" className="btn btn-secondary" onClick={event => showForm(event, selected)}>Edit details</button><button type="button" className="btn btn-ghost text-danger" onClick={() => setDeleting(true)}>Remove drawing</button></div>}
              {deleting && <div className="drawing-delete-confirm"><p>Remove “{selected.title}” from this floorplan?</p><div className="drawing-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDeleting(false)}>Keep drawing</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => action(() => model.remove(selected))}>Remove drawing</button></div></div>}
            </div>}
          </>}
        </>}
        {(editing || (selected && model.valid(selected))) && <div className="equip-field"><label htmlFor="drawing-opacity">Drawing opacity · {model.opacity}%</label><input id="drawing-opacity" type="range" min={model.comparison ? '0' : '10'} max="100" step="5" value={model.opacity} onChange={event => model.setOpacity(Number(event.target.value))} />{model.comparison && <p className="drawing-note">Selected sheet: {model.opacity}% · Comparison sheet: {100 - model.opacity}%. Slide to compare.</p>}</div>}
        {error && <p className="text-danger" role="alert">{error}</p>}
      </div>
      <footer className="drawing-layers-footer">{editing ? <><button type="button" className="btn btn-secondary" disabled={busy} onClick={model.cancelAlignment}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !editing.placement.coverage || (model.matches.length > 0 && !model.matchValid) || (model.tool === 'match' && model.matchPhase === 'target')} onClick={() => action(model.saveAlignment)}>{busy ? 'Saving…' : 'Save placement'}</button></> : <><button type="button" className="btn btn-secondary" onClick={model.floorOnly}>Floorplan only</button>{isEditor && <button type="button" className="btn btn-primary" disabled={model.loading} onClick={event => showForm(event, 'new')}><Plus size={16} />Upload drawing</button>}</>}</footer>
    </section>}
    {!open && selected && model.valid(selected) && <div className="drawing-viewing-label">
      <div className="equip-field drawing-viewing-opacity">
        <DrawingLoadingStatus drawing={model.loadingDrawing} />
        <DrawingLoadError model={model} />
        <label htmlFor="drawing-quick-opacity">{model.comparison ? 'Compare drawings' : 'Drawing opacity'} · {model.opacity}%</label>
        <input id="drawing-quick-opacity" type="range" min={model.comparison ? 0 : 10} max={100} step={5} value={model.opacity} onChange={event => model.setOpacity(Number(event.target.value))} />
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => { model.floorOnly(); trigger.current?.focus(); }} title="Return to floorplan only" aria-label="Return to floorplan only"><X size={16} /></button>
    </div>}
    {form && <FloorplanDrawingForm item={form === 'new' ? null : form} discipline={model.discipline} disciplines={model.disciplines} returnFocus={returnFocus}
      onClose={() => setForm(null)} onSave={data => form === 'new' ? model.create(data) : model.updateMetadata(form, data)} />}
  </>;
}
