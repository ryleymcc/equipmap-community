import { useState, useCallback } from 'react';
import {
  Layers,
  Check,
  X,
  RotateCcw,
  Move,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react';
import './CalibrationControlPanel.css';

export default function CalibrationControlPanel({
  floorplan,
  floorplanId,
  siteFloorplans = [],
  baseFloorplanId,
  onBaseFloorplanChange,
  overlayOpacity,
  setOverlayOpacity,
  overlayTransform,
  setOverlayTransform,
  onSave,
  onCancel,
  onReset
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveClick = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetClick = useCallback(() => {
    if (onReset) {
      onReset();
    } else {
      setOverlayTransform(prev => ({
        ...prev,
        tx: 0,
        ty: 0,
        scale: 1,
        rotation: 0
      }));
    }
  }, [onReset, setOverlayTransform]);

  const handleScaleChange = (e) => {
    const val = parseFloat(e.target.value);
    setOverlayTransform(prev => ({
      ...prev,
      scale: isNaN(val) || val <= 0 ? 1 : val
    }));
  };

  const handleRotationChange = (e) => {
    const val = parseFloat(e.target.value);
    setOverlayTransform(prev => ({
      ...prev,
      rotation: isNaN(val) ? 0 : val
    }));
  };

  const opacityPercent = Math.round((overlayOpacity || 0.5) * 100);
  const currentNumericId = parseInt(floorplanId, 10);

  return (
    <div
      className={`calibration-panel ${isCollapsed ? 'calibration-panel--collapsed' : ''}`}
      role="region"
      aria-label="Floorplan Visual Alignment Controls"
    >
      {/* Header */}
      <div className="calibration-panel-header">
        <div className="calibration-panel-title-group">
          <div className="calibration-panel-icon-box" aria-hidden="true">
            <Layers size={17} />
          </div>
          <div className="calibration-panel-title-text">
            <div className="calibration-panel-title">Visual Alignment</div>
            <div className="calibration-panel-subtitle">
              Aligning: {floorplan?.name || 'Current Floorplan'}
            </div>
          </div>
        </div>

        <div className="calibration-panel-actions">
          <button
            type="button"
            className="calibration-toggle-btn"
            onClick={() => setIsCollapsed(prev => !prev)}
            aria-label={isCollapsed ? 'Expand calibration controls' : 'Collapse calibration controls'}
            title={isCollapsed ? 'Expand controls' : 'Collapse controls'}
          >
            {isCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            <X size={15} />
            <span>Cancel</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveClick}
            disabled={isSaving}
          >
            {isSaving ? (
              <RefreshCw size={15} className="spinning" />
            ) : (
              <Check size={15} />
            )}
            <span>{isSaving ? 'Saving...' : 'Save Alignment'}</span>
          </button>
        </div>
      </div>

      {/* Controls Body */}
      {!isCollapsed && (
        <div className="calibration-panel-body">
          {/* Base Floorplan Field */}
          <div className="calibration-field calibration-field--base">
            <label className="calibration-label" htmlFor="calibration-base-fp">
              Base Floorplan
            </label>
            <select
              id="calibration-base-fp"
              className="input-field"
              value={baseFloorplanId}
              onChange={onBaseFloorplanChange}
            >
              {siteFloorplans.map(fp => (
                <option
                  key={fp.id}
                  value={fp.id}
                  disabled={fp.id === currentNumericId}
                >
                  {fp.name} {fp.id === currentNumericId ? '(Current)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Opacity Field */}
          <div className="calibration-field calibration-field--opacity">
            <div className="calibration-label">
              <span>Opacity</span>
              <span className="calibration-value-badge">{opacityPercent}%</span>
            </div>
            <div className="calibration-range-container">
              <input
                type="range"
                className="calibration-range-input"
                min="0.1"
                max="1"
                step="0.05"
                value={overlayOpacity}
                onChange={e => setOverlayOpacity(parseFloat(e.target.value))}
                aria-label="Overlay opacity"
              />
            </div>
          </div>

          {/* Scale, Rotation, and Reset: grouped cleanly */}
          <div className="calibration-inputs-group">
            {/* Scale Field */}
            <div className="calibration-field calibration-field--number">
              <label className="calibration-label" htmlFor="calibration-scale">
                Scale
              </label>
              <input
                id="calibration-scale"
                type="number"
                step="0.01"
                className="input-field"
                value={Number(overlayTransform.scale.toFixed(3))}
                onChange={handleScaleChange}
              />
            </div>

            {/* Rotation Field */}
            <div className="calibration-field calibration-field--number">
              <label className="calibration-label" htmlFor="calibration-rotation">
                Rot (°)
              </label>
              <input
                id="calibration-rotation"
                type="number"
                step="0.5"
                className="input-field"
                value={Number(overlayTransform.rotation.toFixed(1))}
                onChange={handleRotationChange}
              />
            </div>

            {/* Reset Button */}
            <div className="calibration-field calibration-field--reset">
              <span className="calibration-label calibration-label--spacer" aria-hidden="true">&nbsp;</span>
              <button
                type="button"
                className="calibration-reset-btn"
                onClick={handleResetClick}
                title="Reset offset, scale (1.0) and rotation (0°)"
                aria-label="Reset alignment transform"
              >
                <RotateCcw size={14} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Drag Hint: Desktop */}
          <div className="calibration-panel-hint-desktop">
            <Move size={13} />
            <span>Drag overlay on map to adjust position</span>
          </div>

          {/* Drag Hint: Mobile */}
          <div className="calibration-panel-hint-mobile">
            <Move size={12} />
            <span>Drag floorplan on map to adjust position</span>
          </div>
        </div>
      )}
    </div>
  );
}
