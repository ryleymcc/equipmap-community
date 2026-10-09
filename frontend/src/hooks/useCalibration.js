import { useState, useRef, useCallback, useEffect } from 'react';
import { setRefPoints } from '../api';
import { computeTransform, generateRefPointsFromTransform } from '../alignmentUtils';
import { updateCachedFloorplanReferencePoints } from '../cacheUtils';

export function useCalibration({
  floorplan,
  siteFloorplans,
  setFloorplan,
  setSiteFloorplans,
  floorplanId,
  loadMapData,
  onEnterCalibration
}) {
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [baseFloorplanId, setBaseFloorplanId] = useState('');
  const [overlayTransform, setOverlayTransform] = useState({ tx: 0, ty: 0, scale: 1, rotation: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const overlayDragRef = useRef({ startX: 0, startY: 0, startTx: 0, startTy: 0 });

  const loadInitialTransform = useCallback((baseId) => {
    const baseFp = siteFloorplans.find(fp => fp.id === parseInt(baseId, 10));
    if (!baseFp) return;

    const baseRefPoints = baseFp.reference_points || [];
    const currentRefPoints = floorplan?.reference_points || [];

    if (baseRefPoints.length === 2 && currentRefPoints.length === 2) {
      const t = computeTransform(currentRefPoints, baseRefPoints);
      if (t) {
        setOverlayTransform({
          tx: t.tx,
          ty: t.ty,
          scale: t.scale,
          rotation: t.rotation * (180 / Math.PI)
        });
        return;
      }
    }
    setOverlayTransform({ tx: 0, ty: 0, scale: 1, rotation: 0 });
  }, [siteFloorplans, floorplan]);

  useEffect(() => {
    if (!calibrationMode) return;
    const numericFloorplanId = parseInt(floorplanId, 10);
    let targetBaseId = baseFloorplanId;

    if (!targetBaseId || parseInt(targetBaseId, 10) === numericFloorplanId) {
      const otherFp = siteFloorplans.find(fp => fp.id !== numericFloorplanId && (fp.reference_points || []).length === 2) ||
                      siteFloorplans.find(fp => fp.id !== numericFloorplanId);
      if (otherFp) {
        targetBaseId = otherFp.id.toString();
        // Synchronize the fallback floorplan when its transform is loaded.
        void Promise.resolve().then(() => setBaseFloorplanId(targetBaseId));
      }
    }

    if (targetBaseId) {
      void Promise.resolve().then(() => loadInitialTransform(targetBaseId));
    }
  }, [floorplanId, floorplan, calibrationMode, siteFloorplans, baseFloorplanId, loadInitialTransform]);

  const handleEnterCalibration = useCallback(() => {
    setCalibrationMode(true);
    if (onEnterCalibration) {
      onEnterCalibration();
    }

    const numericFloorplanId = parseInt(floorplanId, 10);
    const otherFp = siteFloorplans.find(fp => fp.id !== numericFloorplanId && (fp.reference_points || []).length === 2);
    if (otherFp) {
      setBaseFloorplanId(otherFp.id.toString());
      // Need to load transform using otherFp.id
      const baseRefPoints = otherFp.reference_points || [];
      const currentRefPoints = floorplan?.reference_points || [];
      if (baseRefPoints.length === 2 && currentRefPoints.length === 2) {
        const t = computeTransform(currentRefPoints, baseRefPoints);
        if (t) {
          setOverlayTransform({
            tx: t.tx,
            ty: t.ty,
            scale: t.scale,
            rotation: t.rotation * (180 / Math.PI)
          });
          return;
        }
      }
      setOverlayTransform({ tx: 0, ty: 0, scale: 1, rotation: 0 });
    } else {
      const anyOtherFp = siteFloorplans.find(fp => fp.id !== numericFloorplanId);
      if (anyOtherFp) {
        setBaseFloorplanId(anyOtherFp.id.toString());
      }
      setOverlayTransform({ tx: 0, ty: 0, scale: 1, rotation: 0 });
    }
  }, [siteFloorplans, floorplanId, floorplan, onEnterCalibration]);

  const handleBaseFloorplanChange = useCallback((e) => {
    const newBaseId = e.target.value;
    setBaseFloorplanId(newBaseId);
    loadInitialTransform(newBaseId);
  }, [loadInitialTransform]);

  const handleSaveCalibration = useCallback(async () => {
    const baseFp = siteFloorplans.find(fp => fp.id === parseInt(baseFloorplanId, 10));
    if (!baseFp) return;

    const visualTransform = {
      ...overlayTransform,
      rotation: overlayTransform.rotation * (Math.PI / 180)
    };

    const baseRefPoints = baseFp.reference_points || [];
    const { basePoints, overlayPoints } = generateRefPointsFromTransform(visualTransform, baseRefPoints);
    const targetFpId = parseInt(floorplanId, 10);
    const siteId = floorplan?.site_id || baseFp?.site_id;

    try {
      if (baseRefPoints.length !== 2) {
        await setRefPoints(baseFp.id, basePoints);
        await updateCachedFloorplanReferencePoints(baseFp.id, basePoints, siteId);
      }
      await setRefPoints(targetFpId, overlayPoints);
      await updateCachedFloorplanReferencePoints(targetFpId, overlayPoints, siteId);

      // Optimistically update React state immediately
      if (setFloorplan) {
        setFloorplan(prev => prev ? { ...prev, reference_points: overlayPoints } : prev);
      }
      if (setSiteFloorplans) {
        setSiteFloorplans(prev => prev.map(fp => {
          if (fp.id === targetFpId) {
            return { ...fp, reference_points: overlayPoints };
          }
          if (baseRefPoints.length !== 2 && fp.id === baseFp.id) {
            return { ...fp, reference_points: basePoints };
          }
          return fp;
        }));
      }

      await loadMapData(false);
      setCalibrationMode(false);
    } catch (err) {
      console.error('Failed to save calibration points:', err);
    }
  }, [baseFloorplanId, overlayTransform, siteFloorplans, floorplanId, floorplan, setFloorplan, setSiteFloorplans, loadMapData]);

  const handleExitCalibration = useCallback(() => {
    setCalibrationMode(false);
  }, []);

  return {
    calibrationMode,
    setCalibrationMode,
    baseFloorplanId,
    setBaseFloorplanId,
    overlayTransform,
    setOverlayTransform,
    overlayOpacity,
    setOverlayOpacity,
    isDraggingOverlay,
    setIsDraggingOverlay,
    overlayDragRef,
    handleEnterCalibration,
    handleBaseFloorplanChange,
    handleSaveCalibration,
    handleExitCalibration,
    loadInitialTransform
  };
}
