import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Document as PdfDocument, Page as PdfPage, pdfjs } from 'react-pdf';
import {
  ArrowLeft, Upload,
  RefreshCw, MapPin, AlertCircle
} from 'lucide-react';
import { getSites, getFloorplans, batchImportEquipment, API_URL } from '../api';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const COLORS = [
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#64748b'  // Slate
];

// Helper to disperse overlapping pins so they are distinct and clickable
const dispersePins = (pins) => {
  const groups = {};
  pins.forEach(pin => {
    // Round coordinates to group very close points
    const key = `${Math.round(pin.x_coordinate)},${Math.round(pin.y_coordinate)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pin);
  });

  const dispersed = [];
  Object.values(groups).forEach(group => {
    if (group.length === 1) {
      dispersed.push({
        ...group[0],
        x_display: group[0].x_coordinate,
        y_display: group[0].y_coordinate
      });
    } else {
      const N = group.length;
      const radius = 35; // offset radius in raw map pixels
      group.forEach((pin, index) => {
        const angle = (2 * Math.PI * index) / N;
        dispersed.push({
          ...pin,
          x_display: pin.x_coordinate + radius * Math.cos(angle),
          y_display: pin.y_coordinate + radius * Math.sin(angle),
          isDispersed: true
        });
      });
    }
  });
  return dispersed;
};

export default function Remapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isEditor, loading } = useAuth();

  useEffect(() => {
    if (!loading && !isEditor) {
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash
          },
          originalFrom: location.state?.from ? {
            pathname: location.state.from.pathname,
            search: location.state.from.search,
            hash: location.state.from.hash
          } : undefined,
          requiredRole: 'editor'
        }
      });
    }
  }, [loading, isEditor, navigate, location]);

  // JSON parsing states
  const [equipmentList, setEquipmentList] = useState([]);
  const [importFileName, setImportFileName] = useState('');

  // Target destination states
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [floorplans, setFloorplans] = useState([]);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState('');
  const [selectedFloorplan, setSelectedFloorplan] = useState(null);

  // Calibration points states
  const [pointA_old, setPointA_old] = useState(null);
  const [pointB_old, setPointB_old] = useState(null);
  const [pointA_new, setPointA_new] = useState(null);
  const [pointB_new, setPointB_new] = useState(null);

  const [searchQueryA, setSearchQueryA] = useState('');
  const [searchQueryB, setSearchQueryB] = useState('');

  // Calibration active mode
  const [calibrationMode, setCalibrationMode] = useState(null); // 'A' or 'B' or null
  const [transformType, setTransformType] = useState('similarity'); // 'similarity' | 'non-uniform' | 'uniform-no-rotation'

  // Style customization states
  const [defaultLocationColor, setDefaultLocationColor] = useState('#3b82f6'); // Blue
  const [defaultEquipmentColor, setDefaultEquipmentColor] = useState('#10b981'); // Emerald

  const [clearExisting, setClearExisting] = useState(false);

  // Status/Import states
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [importError, setImportError] = useState('');

  // Zoom ref & event handling
  const transformComponentRef = useRef(null);
  const mapContentRef = useRef(null);
  const clickStartRef = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef(null);

  // Load sites initially
  useEffect(() => {
    async function loadSites() {
      try {
        const res = await getSites();
        setSites(res.data);
        if (res.data.length > 0) {
          setSelectedSiteId(res.data[0].id.toString());
        }
      } catch (err) {
        console.error('Error loading sites', err);
      }
    }
    if (isEditor) {
      loadSites();
    }
  }, [isEditor]);

  // Load floorplans when selected site changes
  useEffect(() => {
    if (!selectedSiteId || !isEditor) return;
    async function loadFloorplans() {
      try {
        const res = await getFloorplans(parseInt(selectedSiteId));
        setFloorplans(res.data);
        if (res.data.length > 0) {
          setSelectedFloorplanId(res.data[0].id.toString());
          setSelectedFloorplan(res.data[0]);
        } else {
          setSelectedFloorplanId('');
          setSelectedFloorplan(null);
        }
      } catch (err) {
        console.error('Error loading floorplans', err);
      }
    }
    loadFloorplans();
  }, [selectedSiteId, isEditor]);

  const handleZoom = (ref) => {
    if (mapContentRef.current) {
      mapContentRef.current.style.setProperty('--current-zoom', ref.state.scale);
    }
  };

  // Handle floorplan select change
  const handleFloorplanChange = (e) => {
    const fid = e.target.value;
    setSelectedFloorplanId(fid);
    const fp = floorplans.find(f => f.id === parseInt(fid));
    setSelectedFloorplan(fp || null);
    // Reset new points since the map canvas changes
    setPointA_new(null);
    setPointB_new(null);
    setCalibrationMode(null);
  };

  // Parse JSON file
  const handleJsonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const parsed = JSON.parse(text);
        if (!parsed.listWOInfoByFloorPlanID || !Array.isArray(parsed.listWOInfoByFloorPlanID)) {
          throw new Error("JSON must contain 'listWOInfoByFloorPlanID' array.");
        }

        const list = parsed.listWOInfoByFloorPlanID.filter(
          item => item.XCoordinate !== undefined && item.YCoordinate !== undefined
        );

        if (list.length === 0) {
          throw new Error("No equipment items with coordinates found in this file.");
        }

        setEquipmentList(list);

        // Reset points when new file is loaded
        setPointA_old(null);
        setPointB_old(null);
        setPointA_new(null);
        setPointB_new(null);
        setSearchQueryA('');
        setSearchQueryB('');
      } catch (err) {
        setImportError(err.message || "Failed to parse JSON file.");
        setEquipmentList([]);
      }
    };
    reader.readAsText(file);
  };

  // Calibration coordinate calculations
  const transformParams = useMemo(() => {
    if (!pointA_old || !pointB_old || !pointA_new || !pointB_new) return null;

    const xA = pointA_old.XCoordinate;
    const yA = pointA_old.YCoordinate;
    const xB = pointB_old.XCoordinate;
    const yB = pointB_old.YCoordinate;

    const xA_prime = pointA_new.x;
    const yA_prime = pointA_new.y;
    const xB_prime = pointB_new.x;
    const yB_prime = pointB_new.y;

    const dx = xB - xA;
    const dy = yB - yA;
    const dx_prime = xB_prime - xA_prime;
    const dy_prime = yB_prime - yA_prime;

    const denom = dx * dx + dy * dy;
    if (denom === 0) return null;

    if (transformType === 'similarity') {
      const a = (dx_prime * dx + dy_prime * dy) / denom;
      const b = (dy_prime * dx - dx_prime * dy) / denom;
      const tx = xA_prime - a * xA + b * yA;
      const ty = yA_prime - b * xA - a * yA;
      return { type: 'similarity', a, b, tx, ty };
    } else if (transformType === 'non-uniform') {
      if (dx === 0 || dy === 0) return null;
      const sx = dx_prime / dx;
      const sy = dy_prime / dy;
      const tx = xA_prime - sx * xA;
      const ty = yA_prime - sy * yA;
      return { type: 'non-uniform', sx, sy, tx, ty };
    } else { // uniform-no-rotation
      const dist_old = Math.sqrt(dx * dx + dy * dy);
      const dist_new = Math.sqrt(dx_prime * dx_prime + dy_prime * dy_prime);
      if (dist_old === 0) return null;
      const s = dist_new / dist_old;
      const tx = xA_prime - s * xA;
      const ty = yA_prime - s * yA;
      return { type: 'uniform-no-rotation', s, tx, ty };
    }
  }, [pointA_old, pointB_old, pointA_new, pointB_new, transformType]);

  // Map coordinates using current transform parameters
  const mapCoordinate = (x, y, params) => {
    if (!params) return { x, y };
    if (params.type === 'similarity') {
      return {
        x: params.a * x - params.b * y + params.tx,
        y: params.b * x + params.a * y + params.ty
      };
    } else if (params.type === 'non-uniform') {
      return {
        x: params.sx * x + params.tx,
        y: params.sy * y + params.ty
      };
    } else { // uniform-no-rotation
      return {
        x: params.s * x + params.tx,
        y: params.s * y + params.ty
      };
    }
  };

  // Generate preview items dynamically
  const previewEquipment = useMemo(() => {
    if (!transformParams || equipmentList.length === 0) return [];

    const mapped = equipmentList.map((eq, idx) => {
      const mappedCoord = mapCoordinate(eq.XCoordinate, eq.YCoordinate, transformParams);
      const isLocation = eq.IconType === 0;
      const color = isLocation ? defaultLocationColor : defaultEquipmentColor;

      return {
        id: eq.AssetId || eq.IconItemID || `preview-${eq.IconName || 'item'}-${idx}`,
        name: eq.IconName,
        description: eq.LocationName || '',
        x_coordinate: mappedCoord.x,
        y_coordinate: mappedCoord.y,
        color,
      };
    });

    // Apply pin dispersion
    return dispersePins(mapped);
  }, [
    equipmentList, transformParams, defaultLocationColor, defaultEquipmentColor
  ]);

  // Handle clicking on map
  const handleMapClick = (e) => {
    const dx = Math.abs(e.clientX - clickStartRef.current.x);
    const dy = Math.abs(e.clientY - clickStartRef.current.y);
    if (dx > 5 || dy > 5) return; // ignore dragging

    if (!calibrationMode) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const scale = transformComponentRef.current?.state?.scale || 1;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    if (calibrationMode === 'A') {
      setPointA_new({ x, y });
      setCalibrationMode(null);
    } else if (calibrationMode === 'B') {
      setPointB_new({ x, y });
      setCalibrationMode(null);
    }
  };

  // Batch import mapped equipment
  const handleImport = async () => {
    if (!selectedFloorplanId || !transformParams || equipmentList.length === 0) return;
    setIsImporting(true);
    setImportMessage('Mapping coordinates...');
    setImportError('');

    try {
      const itemsToImport = equipmentList.map(eq => {
        const mappedCoord = mapCoordinate(eq.XCoordinate, eq.YCoordinate, transformParams);
        const isLocation = eq.IconType === 0;
        const color = isLocation ? defaultLocationColor : defaultEquipmentColor;

        return {
          name: eq.IconName,
          description: eq.LocationName || '',
          x_coordinate: mappedCoord.x,
          y_coordinate: mappedCoord.y,
          color,
          is_room: isLocation
        };
      });

      setImportMessage(`Importing ${itemsToImport.length} items to database...`);

      const payload = {
        floorplan_id: parseInt(selectedFloorplanId),
        clear_existing: clearExisting,
        items: itemsToImport
      };

      await batchImportEquipment(payload);

      setImportMessage('Success! Equipment successfully imported.');
      setTimeout(() => {
        navigate(`/map/${selectedFloorplanId}`);
      }, 1500);
    } catch (err) {
      console.error(err);
      setImportError(err.response?.data?.detail || err.message || 'Batch import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1120', color: 'white' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!isEditor) return null;

  return (
    <div className="flex-row h-screen w-screen overflow-hidden">
      {/* Left panel - Configurations */}
      <div className="remapper-left-panel p-lg flex-column h-full overflow-y-auto gap-lg z-10">
        <div className="items-center gap-md">
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-xl font-semibold text-primary m-0">Import & Remap</h2>
        </div>

        {/* Step 1: Upload JSON */}
        <div className="glass-panel p-md flex-column gap-md">
          <div className="items-center gap-sm">
            <div className="step-badge-circle">1</div>
            <h3 className="text-md font-semibold m-0">Upload Historical JSON</h3>
          </div>

          <div
            onClick={() => fileInputRef.current.click()}
            className="dropzone-box text-center pointer bg-subtle"
            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--primary-color)'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--surface-border)'}
          >
            <Upload size={24} className="text-muted mb-sm" />
            <div className="text-sm text-primary">
              {importFileName ? importFileName : "Drag & drop or click to upload"}
            </div>
            {equipmentList.length > 0 && (
              <div className="text-xs text-success mt-sm font-bold">
                ✓ {equipmentList.length} items found
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleJsonUpload}
          />
          {importError && (
            <div className="flex-row gap-sm text-danger text-sm mt-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </div>

        {/* Step 2: Select Target Destination */}
        <div className="glass-panel p-md flex-column gap-md">
          <div className="items-center gap-sm">
            <div className="step-badge-circle">2</div>
            <h3 className="text-md font-semibold m-0">Destination Floorplan</h3>
          </div>

          <div className="input-group">
            <label>Select Site</label>
            <select
              className="input-field"
              value={selectedSiteId}
              onChange={e => setSelectedSiteId(e.target.value)}
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label>Select Floorplan</label>
            <select
              className="input-field"
              value={selectedFloorplanId}
              onChange={handleFloorplanChange}
              disabled={floorplans.length === 0}
            >
              {floorplans.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
              {floorplans.length === 0 && <option value="">No floorplans available</option>}
            </select>
          </div>
        </div>

        {/* Step 3 & 4: Reference Calibration */}
        {equipmentList.length > 0 && (
          <div className="glass-panel p-md flex-column gap-md">
            <div className="items-center gap-sm">
              <div className="step-badge-circle">3</div>
              <h3 className="text-md font-semibold m-0">Coordinate Calibration</h3>
            </div>

            <p className="text-sm text-muted m-0">
              Select 2 points from the imported list and map them to their corresponding locations on the new floorplan.
            </p>

            {/* Point A */}
            <div className="ref-point-box p-md bg-subtle">
              <div className="flex-between items-center mb-sm">
                <span className="text-sm font-bold" style={{ color: '#f97316' }}>Reference Point A</span>
                {pointA_new && <span className="text-xs text-success">✓ Mapped</span>}
              </div>

              {!pointA_old ? (
                <div className="relative">
                  <input
                    type="text"
                    className="input-field w-full text-sm p-sm"
                    placeholder="Search equipment for Point A..."
                    value={searchQueryA}
                    onChange={e => setSearchQueryA(e.target.value)}
                  />
                  {searchQueryA && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', zIndex: 100, maxHeight: '150px', overflowY: 'auto' }}>
                      {equipmentList
                        .filter(eq => eq.IconName?.toLowerCase().includes(searchQueryA.toLowerCase()))
                        .slice(0, 10)
                        .map(eq => (
                          <div
                            key={eq.AssetId || eq.IconItemID}
                            style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                            onClick={() => {
                              setPointA_old(eq);
                              setSearchQueryA(eq.IconName);
                            }}
                          >
                            <div className="font-bold">{eq.IconName}</div>
                            <div className="text-xs text-muted">Old: ({eq.XCoordinate}, {eq.YCoordinate})</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-column gap-sm">
                  <div className="text-sm font-bold">{pointA_old.IconName}</div>
                  <div className="text-xs text-muted flex-between">
                    <span>Old: ({pointA_old.XCoordinate}, {pointA_old.YCoordinate})</span>
                    <span>New: {pointA_new ? `(${Math.round(pointA_new.x)}, ${Math.round(pointA_new.y)})` : 'Not placed'}</span>
                  </div>
                  <div className="flex-row gap-sm mt-xs">
                    <button
                      className={`btn ${calibrationMode === 'A' ? 'btn-secondary' : 'btn-primary'} btn-sm flex-1`}
                      onClick={() => setCalibrationMode(calibrationMode === 'A' ? null : 'A')}
                    >
                      {calibrationMode === 'A' ? 'Placing...' : pointA_new ? 'Relocate A' : 'Locate on Map'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setPointA_old(null);
                        setSearchQueryA('');
                        setPointA_new(null);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Point B */}
            <div className="ref-point-box p-md bg-subtle mt-sm">
              <div className="flex-between items-center mb-sm">
                <span className="text-sm font-bold" style={{ color: '#a855f7' }}>Reference Point B</span>
                {pointB_new && <span className="text-xs text-success">✓ Mapped</span>}
              </div>

              {!pointB_old ? (
                <div className="relative">
                  <input
                    type="text"
                    className="input-field w-full text-sm p-sm"
                    placeholder="Search equipment for Point B..."
                    value={searchQueryB}
                    onChange={e => setSearchQueryB(e.target.value)}
                  />
                  {searchQueryB && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', zIndex: 100, maxHeight: '150px', overflowY: 'auto' }}>
                      {equipmentList
                        .filter(eq => eq.IconName?.toLowerCase().includes(searchQueryB.toLowerCase()))
                        .slice(0, 10)
                        .map(eq => (
                          <div
                            key={eq.AssetId || eq.IconItemID}
                            style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                            onClick={() => {
                              setPointB_old(eq);
                              setSearchQueryB(eq.IconName);
                            }}
                          >
                            <div className="font-bold">{eq.IconName}</div>
                            <div className="text-xs text-muted">Old: ({eq.XCoordinate}, {eq.YCoordinate})</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-column gap-sm">
                  <div className="text-sm font-bold">{pointB_old.IconName}</div>
                  <div className="text-xs text-muted flex-between">
                    <span>Old: ({pointB_old.XCoordinate}, {pointB_old.YCoordinate})</span>
                    <span>New: {pointB_new ? `(${Math.round(pointB_new.x)}, ${Math.round(pointB_new.y)})` : 'Not placed'}</span>
                  </div>
                  <div className="flex-row gap-sm mt-xs">
                    <button
                      className={`btn ${calibrationMode === 'B' ? 'btn-secondary' : 'btn-primary'} btn-sm flex-1`}
                      onClick={() => setCalibrationMode(calibrationMode === 'B' ? null : 'B')}
                    >
                      {calibrationMode === 'B' ? 'Placing...' : pointB_new ? 'Relocate B' : 'Locate on Map'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setPointB_old(null);
                        setSearchQueryB('');
                        setPointB_new(null);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Options & Style customization */}
        {pointA_new && pointB_new && (
          <div className="glass-panel p-md flex-column gap-md">
            <div className="items-center gap-sm">
              <div className="step-badge-circle">4</div>
              <h3 className="text-md font-semibold m-0">Mapping & Styling</h3>
            </div>

            <div className="input-group">
              <label>Mapping Algorithm</label>
              <select
                className="input-field"
                value={transformType}
                onChange={e => setTransformType(e.target.value)}
              >
                <option value="similarity">Uniform Scale + Rotation (Similarity)</option>
                <option value="uniform-no-rotation">Uniform Scale (No Rotation)</option>
                <option value="non-uniform">Non-Uniform Scale (No Rotation)</option>
              </select>
            </div>

            <div className="border-top-subtle pt-md">
              <h4 className="text-sm font-bold text-muted mb-sm">Location Styling (IconType = 0)</h4>
              <div className="items-center gap-lg mb-md">
                {/* Color */}
                <div className="flex-row gap-xs">
                  {COLORS.slice(0, 4).map(c => (
                    <div
                      key={c}
                      onClick={() => setDefaultLocationColor(c)}
                      className="color-swatch-sm pointer"
                      style={{
                        backgroundColor: c,
                        border: defaultLocationColor === c ? '2px solid white' : '1px solid transparent',
                      }}
                    />
                  ))}
                </div>
              </div>

              <h4 className="text-sm font-bold text-muted mb-sm">Equipment Styling (IconType = 1)</h4>
              <div className="items-center gap-lg">
                {/* Color */}
                <div className="flex-row gap-xs">
                  {COLORS.slice(0, 4).map(c => (
                    <div
                      key={c}
                      onClick={() => setDefaultEquipmentColor(c)}
                      className="color-swatch-sm pointer"
                      style={{
                        backgroundColor: c,
                        border: defaultEquipmentColor === c ? '2px solid white' : '1px solid transparent',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="items-center gap-sm border-top-subtle pt-md mt-xs">
              <input
                type="checkbox"
                id="clear-existing"
                checked={clearExisting}
                onChange={e => setClearExisting(e.target.checked)}
                className="pointer"
              />
              <label htmlFor="clear-existing" className="text-sm pointer text-primary">
                Clear existing equipment on floorplan before import
              </label>
            </div>
          </div>
        )}

        {/* Step 6: Import button */}
        {pointA_new && pointB_new && equipmentList.length > 0 && (
          <div className="mt-auto flex-column gap-sm">
            {importMessage && (
              <div className="p-md rounded-lg alert-box-primary text-md items-center gap-sm">
                <RefreshCw size={16} className="pin-pulse" />
                <span>{importMessage}</span>
              </div>
            )}

            <button
              className="btn btn-primary btn-full p-lg text-md font-bold"
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? 'Importing...' : `Import ${equipmentList.length} Items`}
            </button>
          </div>
        )}
      </div>

      {/* Right panel - Map Canvas */}
      <div className="remapper-canvas-panel flex-1 min-w-0 overflow-hidden relative h-full">
        {/* Floating Calibration Mode Notice */}
        {calibrationMode && (
          <div className="floating-calibration-toast items-center gap-sm font-bold">
            <MapPin size={18} className="pin-pulse" />
            <span>Click on the map to place Calibration Point {calibrationMode}</span>
          </div>
        )}

        {selectedFloorplan ? (
          <TransformWrapper
            ref={transformComponentRef}
            initialScale={0.5}
            minScale={0.3}
            maxScale={100}
            centerOnInit={true}
            panning={{ velocityDisabled: true }}
            wheel={{ step: 0.05, smoothStep: 0.002 }}
            onInit={handleZoom}
            onZoom={handleZoom}
            onTransformed={handleZoom}
          >
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
              <div
                ref={mapContentRef}
                className="map-content"
                onMouseDown={(e) => { clickStartRef.current = { x: e.clientX, y: e.clientY }; }}
                onClick={handleMapClick}
                style={{
                  cursor: calibrationMode ? 'crosshair' : 'grab',
                  width: '2000px',
                  height: 'max-content',
                  minHeight: '1000px',
                  backgroundColor: 'white',
                  position: 'relative'
                }}
              >
                {selectedFloorplan.file_type === 'pdf' ? (
                  <PdfDocument
                    file={`${API_URL}${selectedFloorplan.file_path}`}
                    loading={<div className="p-2xl text-primary">Loading High-Res Canvas...</div>}
                  >
                    <PdfPage
                      pageNumber={1}
                      width={2000}
                      devicePixelRatio={5}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </PdfDocument>
                ) : (
                  <img
                    src={`${API_URL}${selectedFloorplan.file_path}`}
                    className="svg-layer w-full h-auto object-contain"
                    alt="Floorplan"
                    draggable="false"
                  />
                )}

                {/* Display Point A Marker */}
                {pointA_new && (
                  <div
                    className="pin pin-pulse"
                    style={{
                      left: pointA_new.x,
                      top: pointA_new.y,
                      backgroundColor: '#f97316',
                      color: 'white',
                      width: 'clamp(24px, calc(40px / var(--current-zoom, 1)), 120px)',
                      height: 'clamp(24px, calc(40px / var(--current-zoom, 1)), 120px)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '1.2rem',
                      border: '3px solid white',
                      boxShadow: '0 0 15px rgba(249, 115, 22, 0.8)',
                      zIndex: 1000
                    }}
                    title={`Point A: ${pointA_old?.IconName}`}
                  >
                    A
                  </div>
                )}

                {/* Display Point B Marker */}
                {pointB_new && (
                  <div
                    className="pin pin-pulse"
                    style={{
                      left: pointB_new.x,
                      top: pointB_new.y,
                      backgroundColor: '#a855f7',
                      color: 'white',
                      width: 'clamp(24px, calc(40px / var(--current-zoom, 1)), 120px)',
                      height: 'clamp(24px, calc(40px / var(--current-zoom, 1)), 120px)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '1.2rem',
                      border: '3px solid white',
                      boxShadow: '0 0 15px rgba(168, 85, 247, 0.8)',
                      zIndex: 1000
                    }}
                    title={`Point B: ${pointB_old?.IconName}`}
                  >
                    B
                  </div>
                )}

                {/* Real-time preview pins */}
                {previewEquipment.map(equip => {
                  return (
                    <div
                      key={`preview-${equip.id}`}
                      className="pin"
                      style={{
                        left: equip.x_display,
                        top: equip.y_display,
                        backgroundColor: equip.color,
                        width: 'clamp(8px, calc(28px / var(--current-zoom, 1)), 80px)',
                        height: 'clamp(8px, calc(28px / var(--current-zoom, 1)), 80px)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        opacity: 0.65,
                        boxShadow: `0 clamp(1px, calc(2px / var(--current-zoom, 1)), 6px) clamp(2px, calc(6px / var(--current-zoom, 1)), 18px) ${equip.color}44`
                      }}
                      title={`Preview: ${equip.name}`}
                    >
                    </div>
                  );
                })}
              </div>
            </TransformComponent>
          </TransformWrapper>
        ) : (
          <div className="w-full h-full flex-center text-muted">
            Select a Site and Floorplan to begin mapping...
          </div>
        )}
      </div>
    </div>
  );
}
