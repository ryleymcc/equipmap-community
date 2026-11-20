import { useRef, useEffect, useState, memo, useCallback } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { pdfjs } from 'react-pdf';
import { TiledFloorplan } from './TiledFloorplan';
import { BoundedImageFloorplan } from './BoundedImageFloorplan';
import FloorplanDrawingSurface from './FloorplanDrawingSurface';
import '@google/model-viewer';
import { API_URL } from '../api';
import { AlertCircle, Loader2 } from 'lucide-react';
import { floorplanLogger } from '../floorplanLogger';

if (import.meta.env.VITE_PORTABLE === 'true') {
  const modelViewer = customElements.get('model-viewer');
  modelViewer.dracoDecoderLocation = '/model-decoders/draco/';
  modelViewer.ktx2TranscoderLocation = '/model-decoders/basis/';
}

const pdfWorkerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
// Vite hashes this local worker URL; keep it exact so PWA precaching works offline.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MapCanvas = memo(function MapCanvas({
  transformComponentRef,
  mapContentRef,
  mapMode,
  drawingLayers,
  calibrationMode,
  floorplan,
  baseFloorplanId,
  siteFloorplans,
  overlayOpacity,
  overlayTransform,
  setOverlayTransform,
  isDraggingOverlay,
  setIsDraggingOverlay,
  overlayDragRef,
  setPdfLoaded,
  onAssetError,
  filteredRooms,
  pendingRooms,
  dispersedEquipment,
  tickets = [],
  multiFloorRefPin,
  highlightedPin,
  equipColor,
  showPins = true,
  showPointNames,
  handleMapClick,
  onPinRoomClick,
  onPinEquipClick,
  onPinTicketClick,
  onPinMultiFloorRefClick
}) {
  const editMode = mapMode.type === 'add-placement' || mapMode.type === 'add-form';
  const activeActionType = (mapMode.type === 'add-placement' || mapMode.type === 'add-form') ? mapMode.activeActionType : null;
  const newPinCoord = mapMode.type === 'add-form' ? mapMode.newPinCoord : null;
  const isRelocating = mapMode.type === 'relocate';
  const clickStartRef = useRef({ x: 0, y: 0 });
  const lastViewportTransform = useRef(null);
  const canvasRef = useRef(null);
  const modelViewerRef = useRef(null);
  const [hoveredPin, setHoveredPin] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const mainFp = calibrationMode
    ? siteFloorplans.find(fp => fp.id === parseInt(baseFloorplanId, 10))
    : floorplan;
  const isGlb = mainFp?.file_type === 'glb';
  const minimumScale = drawingLayers?.open ? 0.01 : 0.1;

  useEffect(() => {
    if (isGlb) return;
    const wrapper = transformComponentRef.current?.instance?.wrapperComponent;
    if (!wrapper) return;
    const zoomWithWheel = event => {
      if (!event.deltaY) return;
      const controls = transformComponentRef.current;
      if (!controls) return;
      event.preventDefault();
      const { scale, positionX, positionY } = controls.instance.state;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? wrapper.clientHeight : 1;
      const delta = Math.max(-160, Math.min(160, event.deltaY * units));
      // Keep the change proportional to the current zoom. A fixed decrement
      // can shrink a fitted drawing almost to zero in one wheel notch.
      const nextScale = Math.min(100, Math.max(Math.min(scale, minimumScale), scale * Math.exp(-delta * 0.0035)));
      if (nextScale === scale) return;
      const bounds = wrapper.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const ratio = nextScale / scale;
      controls.setTransform(x + (positionX - x) * ratio, y + (positionY - y) * ratio, nextScale, 0);
    };
    wrapper.addEventListener('wheel', zoomWithWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', zoomWithWheel);
  }, [isGlb, minimumScale, transformComponentRef]);

  const mainFpRef = useRef(mainFp);
  useEffect(() => {
    mainFpRef.current = mainFp;
  }, [mainFp]);

  const onMapLoadSuccess = useCallback((assetDetails = {}, targetFpId = null) => {
    const activeId = targetFpId || mainFpRef.current?.id;
    if (!activeId) return;

    if (activeId === mainFpRef.current?.id) {
      setLoadError(false);
      onAssetError?.(null);
      floorplanLogger.recordAssetSuccess(activeId, {
        fileType: mainFpRef.current?.file_type || 'image',
        ...assetDetails
      });
      if (setPdfLoaded) setPdfLoaded(true);
    }
  }, [setPdfLoaded, onAssetError]);

  const onMapLoadError = useCallback((targetFpId = null, error = null, details = {}) => {
    const activeId = typeof targetFpId === 'number' ? targetFpId : mainFpRef.current?.id;
    floorplanLogger.recordFailure(activeId, error || new Error('Floorplan asset failed to load'), {
      stage: 'asset.load',
      file_path: mainFpRef.current?.file_path,
      file_type: mainFpRef.current?.file_type,
      ...details,
    });
    if (activeId === mainFpRef.current?.id) {
      setLoadError(true);
      onAssetError?.(String(activeId));
    }
  }, [onAssetError]);

  const setModelViewerRef = (node) => {
    if (modelViewerRef.current) {
      modelViewerRef.current.removeEventListener('load', onMapLoadSuccess);
      modelViewerRef.current.removeEventListener('error', onMapLoadError);
    }
    modelViewerRef.current = node;
    if (modelViewerRef.current) {
      modelViewerRef.current.addEventListener('load', () => onMapLoadSuccess({ extraInfo: 'GLB 3D model' }));
      modelViewerRef.current.addEventListener('error', onMapLoadError);
      if (node.loaded) {
        onMapLoadSuccess({ extraInfo: 'GLB 3D model (cached)' });
      }
    }
  };

  // Reset loading/error when floorplan changes and start asset timing
  useEffect(() => {
    setLoadError(false);
    onAssetError?.(null);
    if (!mainFp?.id || !mainFp?.file_path) return;

    if (setPdfLoaded) setPdfLoaded(false);
    floorplanLogger.recordAssetStart(mainFp.id, {
      fileType: mainFp.file_type || 'image', filePath: mainFp.file_path
    });
  }, [mainFp?.id, mainFp?.file_path, mainFp?.file_type, calibrationMode, setPdfLoaded, onAssetError]);

  const notifyContinuousGesture = (phase, gesture, event) => {
    // Wheel/trackpad events have no reliable pointer release; retain their
    // adaptive quiet period instead of treating each wheel callback as a drag.
    if (event?.type === 'wheel') return;
    mapContentRef.current?.dispatchEvent(new CustomEvent('equipmap-map-gesture', {
      detail: { phase, gesture }
    }));
  };

  // Constants for pin rendering (matching CSS)
  const ROOM_RADIUS = 8;
  const EQUIP_RADIUS = 12;
  const TICKET_RADIUS = 10;
  const REF_PIN_RADIUS = 11;
  const HOVER_SCALE = 1.25;

  // ── Rendering Loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    let frameId;

    const draw = () => {
      const canvas = canvasRef.current;
      const state = transformComponentRef.current?.instance?.wrapperState || transformComponentRef.current?.state;

      if (!canvas || !state) {
        frameId = requestAnimationFrame(draw);
        return;
      }

      // Keep the screen-space pin surface bounded on high-DPI monitors too.
      const wrapper = transformComponentRef.current?.instance?.wrapperComponent || canvas.parentElement;
      const rect = wrapper?.getBoundingClientRect();
      const width = rect?.width || 1;
      const height = rect?.height || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4 * 1024 * 1024 / (width * height)));
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Don't draw pins if we're in calibration mode or if the map is still loading/error
      if (calibrationMode || loadError || (!showPins && !(editMode && newPinCoord))) {
        frameId = requestAnimationFrame(draw);
        return;
      }

      const scale = state.scale;
      const panX = state.positionX;
      const panY = state.positionY;
      const time = Date.now();

      // Draw Rooms
      const allRooms = showPins ? [...filteredRooms, ...pendingRooms] : [];
      allRooms.forEach(room => {
        if (room.x_coordinate == null || room.y_coordinate == null) return;
        const sx = room.x_coordinate * scale + panX;
        const sy = room.y_coordinate * scale + panY;

        const isHighlighted = highlightedPin?.type === 'room' && highlightedPin?.id === room.id;
        const isHovered = hoveredPin?.type === 'room' && hoveredPin?.id === room.id;
        const isPending = room.id && String(room.id).startsWith('temp-');

        const baseRadius = ROOM_RADIUS;
        const drawRadius = isHovered ? baseRadius * HOVER_SCALE : baseRadius;

        if (sx < -drawRadius * 4 || sx > width + drawRadius * 4 || sy < -drawRadius * 4 || sy > height + drawRadius * 4) return;

        // Pulse effect for highlighted pins
        if (isHighlighted) {
          const pulse = (time % 1500) / 1500; // 0 to 1 over 1.5s
          const pulseRadius = drawRadius + (pulse < 0.7 ? (pulse / 0.7) * (ROOM_RADIUS * 1.1) : 0);
          const opacity = pulse < 0.7 ? 0.7 * (1 - pulse / 0.7) : 0;

          ctx.beginPath();
          ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(37, 99, 235, ${opacity})`;
          ctx.fill();
        }

        // Main Pin
        ctx.beginPath();
        ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = isPending ? '#94a3b8' : '#2563eb';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw Name if enabled
        if (showPointNames && !isPending) {
          ctx.font = '500 12px Outfit, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const padding = 8;

          const text = room.name;
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const textHeight = 14;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight, 4);
          } else {
            ctx.rect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight);
          }
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.fillText(text, sx + drawRadius + padding, sy);
        }
      });

      // Draw Equipment
      (showPins ? dispersedEquipment : []).forEach(equip => {
        const sx = equip.x_display * scale + panX;
        const sy = equip.y_display * scale + panY;

        const isHighlighted = highlightedPin?.type === 'equipment' && highlightedPin?.id === equip.id;
        const isHovered = hoveredPin?.type === 'equipment' && hoveredPin?.id === equip.id;

        const baseRadius = EQUIP_RADIUS;
        const drawRadius = isHovered ? baseRadius * HOVER_SCALE : baseRadius;

        if (sx < -drawRadius * 4 || sx > width + drawRadius * 4 || sy < -drawRadius * 4 || sy > height + drawRadius * 4) return;

        // Pulse effect for highlighted pins
        if (isHighlighted) {
          const pulse = (time % 1500) / 1500;
          const pulseRadius = drawRadius + (pulse < 0.7 ? (pulse / 0.7) * (ROOM_RADIUS * 1.1) : 0);
          const opacity = pulse < 0.7 ? 0.7 * (1 - pulse / 0.7) : 0;

          ctx.beginPath();
          ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          const colorHex = equip.color || '#10b981';
          ctx.fillStyle = `${colorHex}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`;
          ctx.fill();
        }

        // Main Pin
        ctx.beginPath();
        ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = equip.color || '#10b981';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw Name if enabled
        if (showPointNames) {
          ctx.font = '500 12px Outfit, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const padding = 8;

          const text = equip.name;
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const textHeight = 14;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight, 4);
          } else {
            ctx.rect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight);
          }
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.fillText(text, sx + drawRadius + padding, sy);
        }
      });

      // Draw Tickets
      (showPins ? tickets : []).forEach(ticket => {
        const sx = ticket.x_coordinate * scale + panX;
        const sy = ticket.y_coordinate * scale + panY;

        const isHighlighted = highlightedPin?.type === 'ticket' && highlightedPin?.id === ticket.id;
        const isHovered = hoveredPin?.type === 'ticket' && hoveredPin?.id === ticket.id;

        const baseRadius = TICKET_RADIUS;
        const drawRadius = isHovered ? baseRadius * HOVER_SCALE : baseRadius;

        if (sx < -drawRadius * 4 || sx > width + drawRadius * 4 || sy < -drawRadius * 4 || sy > height + drawRadius * 4) return;

        // Pulse effect for highlighted pins
        if (isHighlighted) {
          const pulse = (time % 1500) / 1500;
          const pulseRadius = drawRadius + (pulse < 0.7 ? (pulse / 0.7) * (ROOM_RADIUS * 1.1) : 0);
          const opacity = pulse < 0.7 ? 0.7 * (1 - pulse / 0.7) : 0;

          ctx.beginPath();
          ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245, 158, 11, ${opacity})`;
          ctx.fill();
        }

        // Main Pin (Ticket is a distinct orange diamond or circle with icon)
        ctx.beginPath();
        // Diamond shape for tickets
        ctx.moveTo(sx, sy - drawRadius);
        ctx.lineTo(sx + drawRadius, sy);
        ctx.lineTo(sx, sy + drawRadius);
        ctx.lineTo(sx - drawRadius, sy);
        ctx.closePath();

        ctx.fillStyle = ticket.status === 'resolved' ? '#10b981' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw '!' icon inside for open tickets
        if (ticket.status === 'open') {
          ctx.font = `bold ${Math.round(drawRadius * 1.2)}px sans-serif`;
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', sx, sy);
        } else if (ticket.status === 'resolved') {
          ctx.font = `bold ${Math.round(drawRadius)}px sans-serif`;
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✓', sx, sy);
        }

        // Draw Title if enabled
        if (showPointNames) {
          ctx.font = '500 12px Outfit, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const padding = 8;

          const text = ticket.title;
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const textHeight = 14;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight, 4);
          } else {
            ctx.rect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight);
          }
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.fillText(text, sx + drawRadius + padding, sy);
        }
      });

      // Draw Multi-Floor Reference Pin
      if (showPins && multiFloorRefPin && multiFloorRefPin.x_coordinate != null && multiFloorRefPin.y_coordinate != null) {
        const sx = multiFloorRefPin.x_coordinate * scale + panX;
        const sy = multiFloorRefPin.y_coordinate * scale + panY;

        const isHovered = hoveredPin?.type === 'multi-floor-ref';
        const baseRadius = REF_PIN_RADIUS;
        const drawRadius = isHovered ? baseRadius * HOVER_SCALE : baseRadius;

        if (sx >= -drawRadius * 4 && sx <= width + drawRadius * 4 && sy >= -drawRadius * 4 && sy <= height + drawRadius * 4) {
          // Pulse halo effect
          const pulse = (time % 2000) / 2000;
          const pulseRadius = drawRadius + pulse * 10;
          const pulseOpacity = (1 - pulse) * 0.45;
          ctx.beginPath();
          ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(139, 92, 246, ${pulseOpacity})`;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Main Pin Body (Purple)
          ctx.beginPath();
          ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#8b5cf6';
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Inner crosshair symbol
          const crossSize = Math.round(drawRadius * 0.6);
          ctx.beginPath();
          ctx.moveTo(sx - crossSize, sy);
          ctx.lineTo(sx + crossSize, sy);
          ctx.moveTo(sx, sy - crossSize);
          ctx.lineTo(sx, sy + crossSize);
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Inner center dot
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();

          // Draw label if enabled
          if (showPointNames) {
            ctx.font = '600 12px Outfit, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const padding = 8;
            const text = 'Ref Pin';
            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            const textHeight = 14;

            ctx.fillStyle = 'rgba(243, 232, 255, 0.92)';
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight, 4);
            } else {
              ctx.rect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight);
            }
            ctx.fill();

            ctx.fillStyle = '#6b21a8';
            ctx.fillText(text, sx + drawRadius + padding, sy);
          }
        }
      }

      // Draw Placement Marker
      if (editMode && newPinCoord) {
        const sx = newPinCoord.x * scale + panX;
        const sy = newPinCoord.y * scale + panY;
        const baseRadius = activeActionType === 'room' ? ROOM_RADIUS : (activeActionType === 'equipment' ? EQUIP_RADIUS : (activeActionType === 'multi-floor-ref' ? REF_PIN_RADIUS : TICKET_RADIUS));

        ctx.beginPath();
        if (activeActionType === 'ticket') {
          ctx.moveTo(sx, sy - baseRadius - 2);
          ctx.lineTo(sx + baseRadius + 2, sy);
          ctx.lineTo(sx, sy + baseRadius + 2);
          ctx.lineTo(sx - baseRadius - 2, sy);
          ctx.closePath();
        } else {
          ctx.arc(sx, sy, baseRadius + 2, 0, Math.PI * 2);
        }

        ctx.fillStyle = activeActionType === 'room' ? '#2563eb' : (activeActionType === 'equipment' ? (equipColor || '#10b981') : (activeActionType === 'multi-floor-ref' ? '#8b5cf6' : '#f59e0b'));
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        const pulse = (Math.sin(time / 200) + 1) / 2;
        ctx.beginPath();
        if (activeActionType === 'ticket') {
           const pr = (baseRadius + 2) + pulse * 6;
           ctx.moveTo(sx, sy - pr);
           ctx.lineTo(sx + pr, sy);
           ctx.lineTo(sx, sy + pr);
           ctx.lineTo(sx - pr, sy);
           ctx.closePath();
        } else {
          ctx.arc(sx, sy, (baseRadius + 2) + pulse * 6, 0, Math.PI * 2);
        }

        const pulseColor = activeActionType === 'room' ? `rgba(37, 99, 235, ${0.5 - pulse * 0.5})` :
                          (activeActionType === 'equipment' ? `${equipColor || '#10b981'}${Math.floor((0.5 - pulse * 0.5) * 255).toString(16).padStart(2, '0')}` :
                          (activeActionType === 'multi-floor-ref' ? `rgba(139, 92, 246, ${0.5 - pulse * 0.5})` :
                          `rgba(245, 158, 11, ${0.5 - pulse * 0.5})`));
        ctx.strokeStyle = pulseColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [filteredRooms, pendingRooms, dispersedEquipment, tickets, multiFloorRefPin, highlightedPin, hoveredPin, editMode, newPinCoord, activeActionType, equipColor, calibrationMode, transformComponentRef, showPins, showPointNames, loadError]);

  // ── Hit Testing ────────────────────────────────────────────────────────────
  const checkPinHit = (clientX, clientY) => {
    if (!showPins) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const state = transformComponentRef.current?.instance?.wrapperState || transformComponentRef.current?.state;
    if (!state) return null;
    const { scale, positionX, positionY } = state;

    // Check Multi-Floor Reference Pin
    if (multiFloorRefPin && multiFloorRefPin.x_coordinate != null && multiFloorRefPin.y_coordinate != null) {
      const sx = multiFloorRefPin.x_coordinate * scale + positionX;
      const sy = multiFloorRefPin.y_coordinate * scale + positionY;
      const radius = hoveredPin?.type === 'multi-floor-ref' ? REF_PIN_RADIUS * HOVER_SCALE : REF_PIN_RADIUS;
      const distSq = (mouseX - sx) ** 2 + (mouseY - sy) ** 2;
      if (distSq <= (radius + 4) ** 2) return { type: 'multi-floor-ref', data: multiFloorRefPin };
    }

    // Check tickets
    for (const ticket of tickets) {
      if (ticket.x_coordinate == null || ticket.y_coordinate == null) continue;
      const sx = ticket.x_coordinate * scale + positionX;
      const sy = ticket.y_coordinate * scale + positionY;
      const radius = hoveredPin?.type === 'ticket' && hoveredPin?.id === ticket.id ? TICKET_RADIUS * HOVER_SCALE : TICKET_RADIUS;
      const distSq = (mouseX - sx) ** 2 + (mouseY - sy) ** 2;
      if (distSq <= (radius + 4) ** 2) return { type: 'ticket', data: ticket };
    }

    // Check equipment
    for (const equip of dispersedEquipment) {
      if (equip.x_display == null || equip.y_display == null) continue;
      const sx = equip.x_display * scale + positionX;
      const sy = equip.y_display * scale + positionY;
      const radius = hoveredPin?.type === 'equipment' && hoveredPin?.id === equip.id ? EQUIP_RADIUS * HOVER_SCALE : EQUIP_RADIUS;
      const distSq = (mouseX - sx) ** 2 + (mouseY - sy) ** 2;
      if (distSq <= (radius + 4) ** 2) return { type: 'equipment', data: equip };
    }

    // Check rooms
    for (const room of filteredRooms) {
      if (room.x_coordinate == null || room.y_coordinate == null) continue;
      const sx = room.x_coordinate * scale + positionX;
      const sy = room.y_coordinate * scale + positionY;
      const radius = hoveredPin?.type === 'room' && hoveredPin?.id === room.id ? ROOM_RADIUS * HOVER_SCALE : ROOM_RADIUS;
      const distSq = (mouseX - sx) ** 2 + (mouseY - sy) ** 2;
      if (distSq <= (radius + 4) ** 2) return { type: 'room', data: room };
    }

    return null;
  };

  const onMouseMove = (e) => {
    const hit = checkPinHit(e.clientX, e.clientY);
    if (hit) {
      const hitId = hit.type === 'multi-floor-ref' ? 'ref-pin' : hit.data.id;
      if (hoveredPin?.type !== hit.type || hoveredPin?.id !== hitId) {
        setHoveredPin({ type: hit.type, id: hitId });
      }
    } else {
      if (hoveredPin !== null) {
        setHoveredPin(null);
      }
    }
  };

  const onMapMouseDown = (e) => {
    clickStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const onMapClickInternal = (e) => {
    const dx = Math.abs(e.clientX - clickStartRef.current.x);
    const dy = Math.abs(e.clientY - clickStartRef.current.y);
    if (dx > 5 || dy > 5) return;

    const drawingPoint = () => {
      const bounds = mapContentRef.current.getBoundingClientRect();
      return { x: Math.max(0, Math.min(100, (e.clientX - bounds.left) / bounds.width * 100)),
        y: Math.max(0, Math.min(100, (e.clientY - bounds.top) / bounds.height * 100)) };
    };
    if (drawingLayers?.editing) { drawingLayers.mapPoint(drawingPoint(), e); return; }

    const hit = checkPinHit(e.clientX, e.clientY);
    if (hit) {
      if (hit.type === 'multi-floor-ref') {
        if (onPinMultiFloorRefClick) onPinMultiFloorRefClick(hit.data);
      } else if (hit.type === 'room') onPinRoomClick(hit.data);
      else if (hit.type === 'equipment') onPinEquipClick(hit.data);
      else if (hit.type === 'ticket') onPinTicketClick(hit.data);
      return;
    }

    if (!calibrationMode && mapMode.type === 'view' && drawingLayers?.open && drawingLayers.mapPoint(drawingPoint())) return;
    handleMapClick(e);
  };

  return (
    <div className="relative w-full h-full bg-white">
      {isGlb ? (
        <div className="relative w-full h-full min-h-80vh bg-slate-50">
          <div
            ref={mapContentRef}
            className="map-content"
            style={{
              width: '100%',
              height: '100%',
              minHeight: '100%',
              backgroundColor: 'white',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {mainFp && (
              <model-viewer
                ref={setModelViewerRef}
                src={`${API_URL}${mainFp.file_path}`}
                alt="3D Floorplan"
                camera-controls
                min-camera-orbit="auto auto 0m"
                style={{ width: '100%', height: '100%', minHeight: '80vh', backgroundColor: '#f8fafc' }}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          <TransformWrapper
            ref={transformComponentRef}
            onTransform={(_, state) => {
              const { scale, positionX, positionY } = state;
              const previous = lastViewportTransform.current;
              if (previous?.scale === scale && previous.positionX === positionX && previous.positionY === positionY) return;
              lastViewportTransform.current = { scale, positionX, positionY };
              // Keep drawing handles at a constant screen size while zooming.
              mapContentRef.current?.style.setProperty('--drawing-view-scale', String(state.scale));
              mapContentRef.current?.dispatchEvent(new Event('equipmap-map-transform'));
            }}
            onPanningStart={(_, event) => notifyContinuousGesture('start', 'pan', event)}
            onPanningStop={(_, event) => notifyContinuousGesture('end', 'pan', event)}
            onPinchStart={(_, event) => notifyContinuousGesture('start', 'pinch', event)}
            onPinchStop={(_, event) => notifyContinuousGesture('end', 'pinch', event)}
            initialScale={1}
            minScale={minimumScale}
            maxScale={100}
            centerOnInit={true}
            // Let floorplan edges move into the viewport center without snapping back.
            limitToBounds={false}
            panning={{ velocityDisabled: true, excluded: ['drawing-region-handle', 'drawing-map-sheet-moving', 'drawing-match-marker'] }}
            doubleClick={{ excluded: ['drawing-match-marker'] }}
            wheel={{ disabled: true }}
          >
            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
              <div
                ref={mapContentRef}
                className="map-content"
                onMouseDown={onMapMouseDown}
                onMouseMove={onMouseMove}
                onClick={onMapClickInternal}
                style={{
                  cursor: (editMode || isRelocating || calibrationMode) ? 'crosshair' : (hoveredPin ? 'pointer' : 'grab'),
                  width: '2000px',
                  height: 'max-content',
                  minHeight: '1000px',
                  backgroundColor: 'white',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {(() => {
                  if (!mainFp) {
                    return (
                      <div className="map-placeholder-dark">
                        <div className="flex-column items-center gap-md">
                          <Loader2 className="spinning" size={32} />
                          <span>Loading Map...</span>
                        </div>
                      </div>
                    );
                  }

                  if (loadError) {
                    return (
                      <div className="map-placeholder-light">
                        <div className="flex-column items-center gap-md">
                          <AlertCircle size={48} color="#ef4444" />
                          <p className="font-medium">Failed to load map image.</p>
                          <button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button>
                        </div>
                      </div>
                    );
                  }

                  const fp = mainFp;
                  return (
                    <div
                      key={`${fp.id}_${fp.file_path}`}
                      id={`floorplan-layer-${fp.id}`}
                      className="w-full h-auto"
                    >
                      {fp.file_type === 'pdf' ? (
                        <TiledFloorplan
                          url={`${API_URL}${fp.file_path}`}
                          transformRef={transformComponentRef}
                          onParsed={pdf => floorplanLogger.recordPdfDocParsed(fp.id, { numPages: pdf.numPages })}
                          onLoad={() => onMapLoadSuccess({ extraInfo: 'Viewport PDF tiles' }, fp.id)}
                          onError={(error, details) => onMapLoadError(fp.id, error, details)}
                        />
                      ) : fp.file_type === 'image' ? (
                        <BoundedImageFloorplan url={`${API_URL}${fp.file_path}`}
                          onLoad={() => onMapLoadSuccess({ extraInfo: 'Bounded image canvas' }, fp.id)}
                          onError={(error, details) => onMapLoadError(fp.id, error, details)} />
                      ) : (
                        <img
                          ref={(el) => {
                            if (el?.complete && el.naturalWidth > 0) {
                              onMapLoadSuccess({ extraInfo: '(memory cache decode)' }, fp.id);
                            }
                          }}
                          src={`${API_URL}${fp.file_path}`}
                          className="svg-layer w-full h-auto object-contain"
                          alt={fp.name || 'Floorplan'}
                          draggable="false"
                          onLoad={() => onMapLoadSuccess({ extraInfo: '(network/disk image decode)' }, fp.id)}
                          onError={() => onMapLoadError(fp.id)}
                        />
                      )}
                    </div>
                  );
                })()}

                {!calibrationMode && drawingLayers && <FloorplanDrawingSurface model={drawingLayers} transformRef={transformComponentRef} />}
                {calibrationMode && floorplan && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '2000px',
                      opacity: overlayOpacity,
                      transformOrigin: '0 0',
                      transform: `translate(${overlayTransform.tx}px, ${overlayTransform.ty}px) rotate(${overlayTransform.rotation}deg) scale(${overlayTransform.scale})`,
                      cursor: isDraggingOverlay ? 'grabbing' : 'grab',
                      zIndex: 10,
                      pointerEvents: 'auto'
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setIsDraggingOverlay(true);
                      const scale = transformComponentRef.current?.instance?.wrapperState?.scale || transformComponentRef.current?.state?.scale || 1;
                      overlayDragRef.current = {
                        startX: e.clientX,
                        startY: e.clientY,
                        startTx: overlayTransform.tx,
                        startTy: overlayTransform.ty,
                        mapScale: scale
                      };
                    }}
                    onPointerMove={(e) => {
                      if (!isDraggingOverlay) return;
                      e.stopPropagation();
                      const { startX, startY, startTx, startTy, mapScale } = overlayDragRef.current;
                      const dx = (e.clientX - startX) / mapScale;
                      const dy = (e.clientY - startY) / mapScale;
                      setOverlayTransform(prev => ({ ...prev, tx: startTx + dx, ty: startTy + dy }));
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      e.currentTarget.releasePointerCapture(e.pointerId);
                      setIsDraggingOverlay(false);
                    }}
                    onPointerCancel={(e) => {
                      e.stopPropagation();
                      setIsDraggingOverlay(false);
                    }}
                  >
                    {floorplan.file_type === 'pdf' ? (
                      <TiledFloorplan
                        key={`${floorplan.id}_${floorplan.file_path}`}
                        url={`${API_URL}${floorplan.file_path}`}
                        transformRef={transformComponentRef}
                        overlay={overlayTransform}
                        onLoad={() => onMapLoadSuccess({ extraInfo: 'Calibration viewport PDF tiles' })}
                        onError={(error, details) => onMapLoadError(null, error, details)}
                      />
                    ) : floorplan.file_type === 'glb' ? (
                      <model-viewer
                        ref={(node) => {
                          if (node) {
                            node.addEventListener('load', () => onMapLoadSuccess({ extraInfo: 'GLB 3D overlay' }), { once: true });
                            if (node.loaded) onMapLoadSuccess({ extraInfo: 'GLB 3D overlay (cached)' });
                          }
                        }}
                        src={`${API_URL}${floorplan.file_path}`}
                        style={{ width: '100%', height: '1000px' }}
                      />
                    ) : floorplan.file_type === 'image' ? (
                      <BoundedImageFloorplan key={`${floorplan.id}_${floorplan.file_path}`}
                        url={`${API_URL}${floorplan.file_path}`}
                        onLoad={() => onMapLoadSuccess({ extraInfo: 'Calibration image canvas' })}
                        onError={(error, details) => onMapLoadError(null, error, details)} />
                    ) : (
                      <img
                        ref={(el) => {
                          if (el?.complete && el.naturalWidth > 0) onMapLoadSuccess({ extraInfo: '(overlay memory cache decode)' });
                        }}
                        src={`${API_URL}${floorplan.file_path}`}
                        alt="Overlay"
                        draggable="false"
                        style={{ width: '100%', height: 'auto' }}
                        onLoad={() => onMapLoadSuccess({ extraInfo: '(overlay network/disk decode)' })}
                        onError={onMapLoadError}
                      />
                    )}
                  </div>
                )}
              </div>
            </TransformComponent>
          </TransformWrapper>
          {!calibrationMode && (
            <canvas
              ref={canvasRef}
              className="map-overlay-canvas"
              hidden={drawingLayers?.editing && drawingLayers.tool === 'match'}
            />
          )}
        </>
      )}
    </div>
  );
});
