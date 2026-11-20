import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage } from '../api';
import { fitDrawingWarp, MAX_DRAWING_MATCHES } from '../drawingWarp';
import { DRAWING_DISCIPLINES } from '../floorplanDrawings';

export function useFloorplanLayers(floorplan, mapContentRef, transformRef) {
  const [open, setOpenState] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestedDiscipline, setDiscipline] = useState('hvac');
  const [selectedId, setSelectedId] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [opacity, setOpacity] = useState(65);
  const [editing, setEditing] = useState(null);
  const [tool, setTool] = useState('move');
  const [point, setPoint] = useState(null);
  const [reload, setReload] = useState(0);
  const [assetError, setAssetError] = useState('');
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [drawingAssetStatuses, setDrawingAssetStatuses] = useState({});
  const [pendingMatch, setPendingMatch] = useState(null);
  const [previewMatch, setPreviewMatch] = useState(false);
  const [matchError, setMatchError] = useState('');
  const floorplanId = floorplan?.id;
  const [ownerId, setOwnerId] = useState(floorplanId);
  const basePath = `/api/floorplans/${floorplanId}/drawings`;

  if (ownerId !== floorplanId) {
    setOwnerId(floorplanId); setOpenState(false); setItems([]); setSelectedId(null); setCompareId(null); setLoading(false);
    setEditing(null); setPoint(null); setError('');
  }
  const setOpen = useCallback(value => {
    setOpenState(value);
    if (value) { setLoading(true); setError(''); }
    else setEditing(null);
  }, []);

  useEffect(() => {
    if (!open || !floorplanId) return;
    const controller = new AbortController();
    api.get(basePath, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setItems(response.data); })
      .catch(err => { if (!controller.signal.aborted) setError(getErrorMessage(err, 'Could not load drawings. Try again.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, floorplanId, basePath, reload]);

  const disciplines = useMemo(() => {
    const options = new Map();
    for (const { discipline } of items) {
      if (!options.has(discipline)) {
        options.set(discipline, Object.hasOwn(DRAWING_DISCIPLINES, discipline) ? DRAWING_DISCIPLINES[discipline] : discipline);
      }
    }
    return options;
  }, [items]);
  const defaultDiscipline = disciplines.has('hvac') ? 'hvac' : disciplines.keys().next().value ?? 'hvac';
  const discipline = disciplines.has(requestedDiscipline) ? requestedDiscipline : defaultDiscipline;
  if (discipline !== requestedDiscipline) setDiscipline(discipline);

  const valid = item => item.placement?.base_file_path === floorplan?.file_path;
  const visible = items.filter(item => item.discipline === discipline);
  const available = visible.filter(valid);
  const contains = (item, position) => {
    const box = item.placement.coverage;
    return position.x >= box.x && position.x <= box.x + box.width && position.y >= box.y && position.y <= box.y + box.height;
  };
  const candidates = point ? available.filter(item => contains(item, point)) : visible;
  const selected = items.find(item => item.id === selectedId && item.discipline === discipline);
  const comparison = items.find(item => item.id === compareId && item.id !== selectedId && valid(item) && item.discipline === discipline);
  const reportDrawingAssetStatus = useCallback((id, status) => {
    setDrawingAssetStatuses(previous => ({ ...previous, [id]: status }));
  }, []);
  const activeDrawings = editing ? [editing] : [selected, comparison].filter(item => item && valid(item));
  const loadingDrawing = activeDrawings.find(item => !drawingAssetStatuses[item.id] || drawingAssetStatuses[item.id] === 'loading');
  const failedDrawing = activeDrawings.find(item => drawingAssetStatuses[item.id] === 'error');
  const replace = item => setItems(previous => previous.map(old => old.id === item.id ? item : old));
  const select = item => { setSelectedId(item.id); setCompareId(null); setAssetError(''); };
  const changeDiscipline = value => { setDiscipline(value); setSelectedId(null); setCompareId(null); setPoint(null); };
  const beginAlignment = item => {
    const matches = valid(item) ? item.placement?.matches || [] : [];
    setSelectedId(item.id); setCompareId(null); setPoint(null); setTool(matches.length ? 'pan' : 'move');
    setPendingMatch(null); setPreviewMatch(false); setMatchError('');
    setEditing({ ...item, placement: { x: 0, y: 0, scale: 1, rotation: 0, crop: { x: 0, y: 0, width: 100, height: 100 },
      coverage: null, ...item.placement, matches, base_file_path: floorplan.file_path } });
  };
  const matches = editing?.placement.matches;
  const matchValid = useMemo(() => Boolean(matches && fitDrawingWarp(matches)), [matches]);
  const updatePlacement = useCallback(patch => setEditing(previous => previous ? { ...previous, placement: { ...previous.placement, ...patch } } : previous), []);
  const showRegion = (kind, explicitRegion) => {
    const map = mapContentRef.current, controls = transformRef.current;
    const wrapper = controls?.instance?.wrapperComponent;
    const item = editing || selected;
    if (!map || !wrapper || !item) return;
    const region = explicitRegion || (kind === 'crop' ? item.placement?.crop : item.placement?.coverage) || { x: 0, y: 0, width: 100, height: 100 };
    const width = map.offsetWidth, height = map.offsetHeight;
    let points = [[region.x / 100 * width, region.y / 100 * height], [(region.x + region.width) / 100 * width, (region.y + region.height) / 100 * height]];
    if (kind === 'crop') {
      const sheet = map.querySelector('.drawing-map-sheet');
      if (!sheet?.offsetHeight) return;
      const placement = item.placement, angle = placement.rotation * Math.PI / 180;
      points = [[region.x, region.y], [region.x + region.width, region.y], [region.x, region.y + region.height], [region.x + region.width, region.y + region.height]].map(([x, y]) => {
        const sx = x / 100 * sheet.offsetWidth * placement.scale, sy = y / 100 * sheet.offsetHeight * placement.scale;
        return [placement.x / 100 * width + sx * Math.cos(angle) - sy * Math.sin(angle), placement.y / 100 * height + sx * Math.sin(angle) + sy * Math.cos(angle)];
      });
    }
    const bounds = wrapper.getBoundingClientRect(), panel = document.getElementById('drawing-layers-panel')?.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-7'));
    const trigger = document.querySelector('.drawing-layers-trigger')?.getBoundingClientRect();
    const label = document.querySelector('.drawing-viewing-label')?.getBoundingClientRect();
    const left = gap, top = Math.max(trigger?.bottom || 0, label && label.top < bounds.height / 2 ? label.bottom : 0) - bounds.top + gap;
    const right = panel && panel.left > bounds.width / 3 ? panel.left - bounds.left - gap : bounds.width - gap;
    const bottom = panel && panel.left <= bounds.width / 3 ? panel.top - bounds.top - gap : bounds.height - gap;
    const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
    const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
    if (right <= left || bottom <= top) return;
    const scale = Math.max(0.01, Math.min(100, (right - left) / Math.max(1, (maxX - minX) * 1.25), (bottom - top) / Math.max(1, (maxY - minY) * 1.25)));
    controls.setTransform((left + right) / 2 - (minX + maxX) / 2 * scale, (top + bottom) / 2 - (minY + maxY) / 2 * scale, scale, 0);
  };
  const editRegion = kind => {
    setTool(kind);
    const region = kind === 'coverage' ? editing.placement.coverage || { x: 10, y: 10, width: 80, height: 80 } : editing.placement.crop;
    if (kind === 'coverage' && !editing.placement.coverage) updatePlacement({ coverage: region });
    showRegion(kind, region);
  };
  const matchPhase = previewMatch ? 'preview' : pendingMatch ? 'target' : 'source';
  const addMatchPoint = position => {
    if (previewMatch || matches.length >= MAX_DRAWING_MATCHES) return;
    if (pendingMatch) {
      if (matches.some(pair => Math.hypot(pair.target.x - position.x, pair.target.y - position.y) < 0.1)) {
        setMatchError('Choose a floorplan landmark you haven’t matched yet.');
        return;
      }
      updatePlacement({ matches: [...matches, { source: pendingMatch, target: position }] });
      setPendingMatch(null); setMatchError('');
      return;
    }
    if (matches.some(pair => Math.hypot(pair.source.x - position.x, pair.source.y - position.y) < 0.1)) {
      setMatchError('Choose a drawing landmark you haven’t matched yet.');
      return;
    }
    setPendingMatch(position); setMatchError('');
  };
  const chooseMatch = (position, event) => {
    if (pendingMatch) { addMatchPoint(position); return; }
    const sheet = mapContentRef.current?.querySelector('.drawing-map-sheet');
    if (sheet?.dataset.drawingStatus !== 'ready') return;
    const frame = sheet?.getBoundingClientRect();
    const map = mapContentRef.current;
    if (!frame?.width || !sheet.offsetHeight || !map?.offsetWidth) return;
    const zoom = map.getBoundingClientRect().width / map.offsetWidth;
    const { x, y, rotation, scale } = editing.placement;
    const bounds = map.getBoundingClientRect();
    const angle = rotation * Math.PI / 180;
    const dx = event.clientX - bounds.left - bounds.width * x / 100;
    const dy = event.clientY - bounds.top - bounds.height * y / 100;
    const source = {
      x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / (zoom * scale * sheet.offsetWidth) * 100,
      y: (dy * Math.cos(angle) - dx * Math.sin(angle)) / (zoom * scale * sheet.offsetHeight) * 100,
    };
    if (Object.values(source).some(value => value < 0 || value > 100)) {
      setMatchError('Choose a landmark inside the drawing.');
      return;
    }
    addMatchPoint(source);
  };
  const mapPoint = (position, event) => {
    if (editing && tool === 'match') chooseMatch(position, event);
    if (editing) return true;
    if (open) { setPoint(position); return true; }
    return false;
  };
  const create = async data => {
    const response = await api.post(basePath, data);
    setItems(previous => [response.data, ...previous]);
    changeDiscipline(response.data.discipline); select(response.data);
    return response.data;
  };
  const updateMetadata = async (item, data) => {
    const response = await api.put(`${basePath}/${item.id}`, data);
    replace(response.data); changeDiscipline(response.data.discipline); select(response.data);
  };
  const saveAlignment = async () => {
    const response = await api.put(`${basePath}/${editing.id}/placement`, editing.placement);
    replace(response.data); setEditing(null);
  };
  const remove = async item => {
    await api.delete(`${basePath}/${item.id}`);
    setItems(previous => previous.filter(old => old.id !== item.id));
    if (selectedId === item.id) setSelectedId(null);
    if (compareId === item.id) setCompareId(null);
  };
  return { open, setOpen, items, visible, available, candidates, selected, comparison, selectedId, compareId, setCompareId,
    loading, error, retry: () => { setLoading(true); setError(''); setReload(value => value + 1); }, discipline, disciplines, changeDiscipline,
    assetError, setAssetError, assetAttempt, loadingDrawing, failedDrawing, reportDrawingAssetStatus,
    retryAssets: () => { setAssetError(''); setAssetAttempt(value => value + 1); },
    opacity, setOpacity, editing, tool, setTool, point, setPoint, select, valid, beginAlignment, updatePlacement, editRegion, showRegion,
    matches: matches || [], matchValid, matchPhase, matchError, addMatchPoint,
    startMatching: () => { setPendingMatch(null); setPreviewMatch(false); setMatchError(''); setTool('match'); },
    toggleMatchPreview: () => { setPendingMatch(null); setPreviewMatch(!previewMatch); setMatchError(''); },
    removeMatch: index => {
      const remaining = matches.filter((_, i) => i !== index);
      updatePlacement({ matches: remaining });
      if (previewMatch && !fitDrawingWarp(remaining)) setPreviewMatch(false);
      setMatchError('');
    },
    cancelMatchPair: () => {
      setPendingMatch(null); setPreviewMatch(false); setMatchError('');
    },
    wholeFloor: () => { const coverage = { x: 0, y: 0, width: 100, height: 100 }; updatePlacement({ coverage }); setTool('coverage'); showRegion('coverage', coverage); },
    cancelAlignment: () => setEditing(null),
    floorOnly: () => { setSelectedId(null); setCompareId(null); setPoint(null); },
    create, updateMetadata, saveAlignment, remove, mapPoint };
}
