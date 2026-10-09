import { useRef, useEffect, useState, memo } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Document as PdfDocument, Page as PdfPage, pdfjs } from 'react-pdf';
import '@google/model-viewer';
import { API_URL } from '../api';
import { AlertCircle, Loader2 } from 'lucide-react';
import { floorplanLogger } from '../floorplanLogger';

function getWorkOrderMapPosition(workOrder, allRooms, allEquipment) {
  const linkedRoomIds = new Set((workOrder.rooms || []).map(room => room.id));
  const linkedEquipmentIds = new Set((workOrder.equipment || []).map(equipment => equipment.id));
  const linkedRoom = allRooms.find(room => (
    linkedRoomIds.has(room.id) &&
    room.x_coordinate != null &&
    room.y_coordinate != null
  ));
  const linkedEquipment = allEquipment.find(equipment => (
    linkedEquipmentIds.has(equipment.id) &&
    equipment.x_coordinate != null &&
    equipment.y_coordinate != null
  ));

  // A single linked room/equipment is the work order's map location. Resolve
  // against current map data so the badge follows relocation without requiring
  // a work-order edit or a stale coordinate update.
  if (workOrder.location_type === 'room' && linkedRoom) {
    return { x: linkedRoom.x_coordinate, y: linkedRoom.y_coordinate };
  }
  if (workOrder.location_type === 'equipment' && linkedEquipment) {
    return { x: linkedEquipment.x_coordinate, y: linkedEquipment.y_coordinate };
  }

  return { x: workOrder.x_coordinate, y: workOrder.y_coordinate };
}

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const MapCanvas = memo(function MapCanvas({
  transformComponentRef,
  mapContentRef,
  mapMode,
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
  filteredRooms,
  allRooms = [],
  pendingRooms,
  dispersedEquipment,
  allEquipment = [],
  tickets = [],
  workOrders = [],
  multiFloorRefPin,
  highlightedPin,
  equipColor,
  showPointNames,
  handleMapClick,
  onPinRoomClick,
  onPinEquipClick,
  onPinTicketClick,
  onPinWorkOrderClick,
  onPinMultiFloorRefClick
}) {
  const editMode = mapMode.type === 'add-placement' || mapMode.type === 'add-form';
  const activeActionType = (mapMode.type === 'add-placement' || mapMode.type === 'add-form') ? mapMode.activeActionType : null;
  const newPinCoord = mapMode.type === 'add-form' ? mapMode.newPinCoord : null;
  const isRelocating = mapMode.type === 'relocate';
  const clickStartRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const modelViewerRef = useRef(null);
  const [hoveredPin, setHoveredPin] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const mainFp = calibrationMode
    ? siteFloorplans.find(fp => fp.id === parseInt(baseFloorplanId, 10))
    : floorplan;
  const isGlb = mainFp?.file_type === 'glb';

  const onMapLoadSuccess = (assetDetails = {}) => {
    setLoadError(false);
    if (mainFp?.id) {
      floorplanLogger.recordAssetSuccess(mainFp.id, {
        fileType: mainFp.file_type || 'image',
        ...assetDetails
      });
    }
    if (setPdfLoaded) setPdfLoaded(true);
  };

  const onMapLoadError = () => {
    setLoadError(true);
  };

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
    if (setPdfLoaded) setPdfLoaded(false);
    if (mainFp?.id && mainFp?.file_path) {
      floorplanLogger.recordAssetStart(mainFp.id, {
        fileType: mainFp.file_type || 'image',
        filePath: mainFp.file_path
      });
    }
  }, [floorplan?.id, mainFp?.id, mainFp?.file_path, mainFp?.file_type, calibrationMode, setPdfLoaded]);


  // Constants for pin rendering (matching CSS)
  const ROOM_RADIUS = 8;
  const EQUIP_RADIUS = 12;
  const TICKET_RADIUS = 10;
  const WORK_ORDER_RADIUS = 13;
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

      // Sync canvas size if needed
      const wrapper = transformComponentRef.current?.wrapperElement || canvas.parentElement;
      const rect = wrapper?.getBoundingClientRect();
      if (rect && (canvas.width !== rect.width * (window.devicePixelRatio || 1) || canvas.height !== rect.height * (window.devicePixelRatio || 1))) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const ctx = canvas.getContext('2d');
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, width, height);

      // Don't draw pins if we're in calibration mode or if the map is still loading/error
      if (calibrationMode || loadError) {
        frameId = requestAnimationFrame(draw);
        return;
      }

      const scale = state.scale;
      const panX = state.positionX;
      const panY = state.positionY;
      const time = Date.now();

      // Draw Rooms
      const allRooms = [...filteredRooms, ...pendingRooms];
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
      dispersedEquipment.forEach(equip => {
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
      tickets.forEach(ticket => {
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

      // Draw Work Orders (only open work orders)
      const openWorkOrders = workOrders.filter(wo => wo.status !== 'completed' && wo.status !== 'cancelled' && wo.status !== 'rejected');
      openWorkOrders.forEach(wo => {
        const workOrderPosition = getWorkOrderMapPosition(wo, allRooms, allEquipment);
        if (workOrderPosition.x == null || workOrderPosition.y == null) return;
        const sx = workOrderPosition.x * scale + panX;
        const sy = workOrderPosition.y * scale + panY;

        const isHighlighted = highlightedPin?.type === 'workOrder' && highlightedPin?.id === wo.id;
        const isHovered = hoveredPin?.type === 'workOrder' && hoveredPin?.id === wo.id;

        const baseRadius = WORK_ORDER_RADIUS;
        const drawRadius = isHovered ? baseRadius * HOVER_SCALE : baseRadius;

        if (sx < -drawRadius * 4 || sx > width + drawRadius * 4 || sy < -drawRadius * 4 || sy > height + drawRadius * 4) return;

        let priorityColor = '#3b82f6';
        if (wo.priority === 'urgent') priorityColor = '#ef4444';
        else if (wo.priority === 'high') priorityColor = '#f97316';
        else if (wo.priority === 'low') priorityColor = '#10b981';

        let statusColor = '#0284c7';
        if (wo.status === 'pending_triage') statusColor = '#f59e0b';
        else if (wo.status === 'in_progress') statusColor = '#6366f1';
        else if (wo.status === 'on_hold') statusColor = '#64748b';

        // Pulse effect for highlighted pins or urgent open work orders
        if (isHighlighted || (wo.priority === 'urgent' && wo.status !== 'completed')) {
          const pulse = (time % 1500) / 1500;
          const pulseRadius = drawRadius + (pulse < 0.7 ? (pulse / 0.7) * (WORK_ORDER_RADIUS * 1.2) : 0);
          const opacity = pulse < 0.7 ? 0.7 * (1 - pulse / 0.7) : 0;

          ctx.beginPath();
          ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          ctx.fillStyle = wo.priority === 'urgent' ? `rgba(239, 68, 68, ${opacity})` : `rgba(59, 130, 246, ${opacity})`;
          ctx.fill();
        }

        // Draw badge pin (circle with priority outer ring & status fill)
        ctx.beginPath();
        ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();
        ctx.strokeStyle = priorityColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Inner white symbol: W / !
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (wo.status === 'pending_triage') {
          ctx.font = `bold ${Math.round(drawRadius * 1.1)}px sans-serif`;
          ctx.fillText('!', sx, sy);
        } else {
          ctx.font = `bold ${Math.round(drawRadius * 0.9)}px sans-serif`;
          ctx.fillText('W', sx, sy);
        }

        // Draw Name / WO Number tag if enabled
        if (showPointNames) {
          ctx.font = '600 12px Outfit, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const padding = 8;

          const text = `${wo.order_number || 'WO'}: ${wo.title}`;
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const textHeight = 16;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight, 4);
          } else {
            ctx.rect(sx + drawRadius + padding - 4, sy - textHeight / 2, textWidth + 8, textHeight);
          }
          ctx.fill();
          ctx.strokeStyle = priorityColor;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.fillText(text, sx + drawRadius + padding, sy);
        }
      });

      // Draw Multi-Floor Reference Pin
      if (multiFloorRefPin && multiFloorRefPin.x_coordinate != null && multiFloorRefPin.y_coordinate != null) {
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
  }, [filteredRooms, pendingRooms, dispersedEquipment, allRooms, allEquipment, tickets, workOrders, multiFloorRefPin, highlightedPin, hoveredPin, editMode, newPinCoord, activeActionType, equipColor, calibrationMode, transformComponentRef, showPointNames, loadError]);

  // ── Hit Testing ────────────────────────────────────────────────────────────
  const checkPinHit = (clientX, clientY) => {
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

    // Work-order badges frequently share a room or equipment pin's coordinates.
    // Resolve the badge target against the complete floorplan data set so a search
    // filter cannot change the interaction from an asset drawer to a WO modal.
    const getLinkedItemAtWorkOrderPin = (wo) => {
      const workOrderPosition = getWorkOrderMapPosition(wo, allRooms, allEquipment);
      const sharesCoordinates = (item) => (
        item.x_coordinate != null && item.y_coordinate != null &&
        Math.abs(item.x_coordinate - workOrderPosition.x) < 0.001 &&
        Math.abs(item.y_coordinate - workOrderPosition.y) < 0.001
      );

      // Match normal hit-test priority: equipment before rooms.
      const linkedEquipmentIds = new Set((wo.equipment || []).map(item => item.id));
      const linkedItems = [
        ...allEquipment
          .filter(item => linkedEquipmentIds.has(item.id))
          .map(data => ({ type: 'equipment', data })),
      ];

      const linkedRoomIds = new Set((wo.rooms || []).map(item => item.id));
      linkedItems.push(
        ...allRooms
          .filter(item => linkedRoomIds.has(item.id))
          .map(data => ({ type: 'room', data }))
      );

      // Prefer an exact coordinate match. If this work order has only one linked
      // item, use it even if older coordinates no longer line up exactly.
      return linkedItems.find(({ data }) => sharesCoordinates(data)) ||
        (linkedItems.length === 1 ? linkedItems[0] : null);
    };

    // Only standalone open work-order pins should open the work-order detail modal.
    const openWorkOrders = workOrders.filter(wo => wo.status !== 'completed' && wo.status !== 'cancelled' && wo.status !== 'rejected');
    for (const wo of openWorkOrders) {
      const workOrderPosition = getWorkOrderMapPosition(wo, allRooms, allEquipment);
      if (workOrderPosition.x == null || workOrderPosition.y == null) continue;
      const sx = workOrderPosition.x * scale + positionX;
      const sy = workOrderPosition.y * scale + positionY;
      const radius = hoveredPin?.type === 'workOrder' && hoveredPin?.id === wo.id ? WORK_ORDER_RADIUS * HOVER_SCALE : WORK_ORDER_RADIUS;
      const distSq = (mouseX - sx) ** 2 + (mouseY - sy) ** 2;
      if (distSq <= (radius + 4) ** 2) {
        return getLinkedItemAtWorkOrderPin(wo) || { type: 'workOrder', data: wo };
      }
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

    const hit = checkPinHit(e.clientX, e.clientY);
    if (hit) {
      if (hit.type === 'multi-floor-ref') {
        if (onPinMultiFloorRefClick) onPinMultiFloorRefClick(hit.data);
      } else if (hit.type === 'room') onPinRoomClick(hit.data);
      else if (hit.type === 'equipment') onPinEquipClick(hit.data);
      else if (hit.type === 'ticket') onPinTicketClick(hit.data);
      else if (hit.type === 'workOrder') {
        if (onPinWorkOrderClick) onPinWorkOrderClick(hit.data);
      }
      return;
    }

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
            initialScale={1}
            minScale={0.5}
            maxScale={100}
            centerOnInit={true}
            panning={{ velocityDisabled: true }}
            wheel={{ step: 0.01, smoothStep: 0.002 }}
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

                  return (
                    <>
                      {mainFp.file_type === 'pdf' ? (
                        <PdfDocument
                          file={`${API_URL}${mainFp.file_path}`}
                          onLoadSuccess={(pdf) => {
                            floorplanLogger.recordPdfDocParsed(mainFp?.id, { numPages: pdf?.numPages || 1 });
                          }}
                          onLoadError={onMapLoadError}
                          loading={null}
                        >
                          <PdfPage
                            pageNumber={1}
                            width={2000}
                            devicePixelRatio={5}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            onRenderSuccess={() => onMapLoadSuccess({ extraInfo: '(devicePixelRatio: 5, width: 2000px)' })}
                            onRenderError={onMapLoadError}
                          />
                        </PdfDocument>
                      ) : (
                        <img
                          ref={(el) => {
                            if (el?.complete && el.naturalWidth > 0) onMapLoadSuccess({ extraInfo: '(memory cache decode)' });
                          }}
                          src={`${API_URL}${mainFp.file_path}`}
                          className="svg-layer w-full h-auto object-contain"
                          alt="Floorplan"
                          draggable="false"
                          onLoad={() => onMapLoadSuccess({ extraInfo: '(network/disk image decode)' })}
                          onError={onMapLoadError}
                        />
                      )}
                    </>
                  );
                })()}

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
                      <PdfDocument file={`${API_URL}${floorplan.file_path}`} loading={null}>
                        <PdfPage
                          pageNumber={1}
                          width={2000}
                          devicePixelRatio={5}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                        />
                      </PdfDocument>
                    ) : floorplan.file_type === 'glb' ? (
                      <model-viewer src={`${API_URL}${floorplan.file_path}`} style={{ width: '100%', height: '1000px' }} />
                    ) : (
                      <img src={`${API_URL}${floorplan.file_path}`} alt="Overlay" draggable="false" style={{ width: '100%', height: 'auto' }} />
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
            />
          )}
        </>
      )}
    </div>
  );
});
