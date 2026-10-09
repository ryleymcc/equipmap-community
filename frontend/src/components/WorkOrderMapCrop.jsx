import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Building } from 'lucide-react';
import { API_URL, getFloorplan } from '../api';
import { pdfjs } from 'react-pdf';

// Ensure PDF.js worker is properly configured
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

// In-memory cache for floorplan metadata and loaded images/canvases
const floorplanDataCache = new Map();
const imageCache = new Map();
const pdfDocCache = new Map();

export default function WorkOrderMapCrop({
  workOrder,
  floorplan: providedFloorplan = null,
  width = 560,
  height = 340,
  cropZoom = 1.0, // 1.0 = standard context (approx 550px wide region), >1.0 = tighter zoom
  showPinLabel = true,
  className = '',
  style = {}
}) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [floorplan, setFloorplan] = useState(providedFloorplan);
  const [dataUrl, setDataUrl] = useState(null);

  // 1. Resolve Location Coordinates & Entity Labels
  let targetX = workOrder?.x_coordinate;
  let targetY = workOrder?.y_coordinate;
  let floorplanId = workOrder?.floorplan_id || providedFloorplan?.id;
  let locationLabel = workOrder?.location_details || '';

  if ((targetX == null || targetY == null) && workOrder?.rooms?.length > 0) {
    const locatedRoom = workOrder.rooms.find(r => r.x_coordinate != null && r.y_coordinate != null) || workOrder.rooms[0];
    if (locatedRoom.x_coordinate != null) {
      targetX = locatedRoom.x_coordinate;
      targetY = locatedRoom.y_coordinate;
      if (!floorplanId) floorplanId = locatedRoom.floorplan_id;
      if (!locationLabel) locationLabel = `Room ${locatedRoom.name}`;
    }
  }

  if ((targetX == null || targetY == null) && workOrder?.equipment?.length > 0) {
    const locatedEquip = workOrder.equipment.find(e => e.x_coordinate != null && e.y_coordinate != null) || workOrder.equipment[0];
    if (locatedEquip.x_coordinate != null) {
      targetX = locatedEquip.x_coordinate;
      targetY = locatedEquip.y_coordinate;
      if (!floorplanId) floorplanId = locatedEquip.floorplan_id;
      if (!locationLabel) locationLabel = locatedEquip.name;
    }
  }

  if (!locationLabel) {
    if (workOrder?.rooms?.length > 0) {
      locationLabel = `Room ${workOrder.rooms[0].name}`;
    } else if (workOrder?.equipment?.length > 0) {
      locationLabel = workOrder.equipment[0].name;
    } else {
      locationLabel = workOrder?.order_number ? `${workOrder.order_number} Location` : 'Work Location';
    }
  }

  const hasCoordinates = targetX != null && targetY != null;

  // 2. Fetch Floorplan Details if not provided
  useEffect(() => {
    let isMounted = true;

    async function loadFloorplanInfo() {
      if (providedFloorplan) {
        setFloorplan(providedFloorplan);
        return;
      }

      if (!floorplanId) {
        setLoading(false);
        return;
      }

      if (floorplanDataCache.has(floorplanId)) {
        setFloorplan(floorplanDataCache.get(floorplanId));
        return;
      }

      try {
        setLoading(true);
        const res = await getFloorplan(floorplanId);
        if (isMounted) {
          floorplanDataCache.set(floorplanId, res.data);
          setFloorplan(res.data);
        }
      } catch (err) {
        console.warn(`Could not load floorplan ${floorplanId} for map crop:`, err);
        if (isMounted) {
          setError('Failed to load floorplan metadata');
          setLoading(false);
        }
      }
    }

    loadFloorplanInfo();

    return () => {
      isMounted = false;
    };
  }, [floorplanId, providedFloorplan]);

  // 3. Render High-Resolution Cropped Map onto Canvas
  useEffect(() => {
    let isMounted = true;

    async function renderMap() {
      if (!floorplan?.file_path || !hasCoordinates) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 2;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background fill
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      const fileUrl = `${API_URL}${floorplan.file_path}`;
      const isPdf = floorplan.file_type === 'pdf';

      try {
        let sourceWidth = 2000;
        let sourceHeight = 1500;
        let sourceDrawable = null;

        if (isPdf) {
          // Render PDF page to an offscreen canvas at standard 2000px resolution
          let pdfDoc = pdfDocCache.get(fileUrl);
          if (!pdfDoc) {
            const loadingTask = pdfjs.getDocument(fileUrl);
            pdfDoc = await loadingTask.promise;
            pdfDocCache.set(fileUrl, pdfDoc);
          }

          const page = await pdfDoc.getPage(1);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const targetScale = 2000 / unscaledViewport.width;
          const viewport = page.getViewport({ scale: targetScale });

          sourceWidth = viewport.width;
          sourceHeight = viewport.height;

          const offscreen = document.createElement('canvas');
          offscreen.width = sourceWidth;
          offscreen.height = sourceHeight;
          const offCtx = offscreen.getContext('2d');

          await page.render({
            canvasContext: offCtx,
            viewport: viewport
          }).promise;

          sourceDrawable = offscreen;
        } else {
          // Load Image / SVG
          let img = imageCache.get(fileUrl);
          if (!img || !img.complete) {
            img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = fileUrl;
            await new Promise((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = (e) => reject(e);
            });
            imageCache.set(fileUrl, img);
          }

          sourceDrawable = img;
          sourceWidth = img.naturalWidth || 2000;
          sourceHeight = img.naturalHeight || 1500;
        }

        if (!isMounted) return;

        // EquipMap pins are placed in a 2000px coordinate system
        const scaleTo2000 = sourceWidth / 2000;
        const normalizedTargetX = targetX * scaleTo2000;
        const normalizedTargetY = targetY * scaleTo2000;

        // Determine crop box size in the source coordinate system
        // Standard window: approx 550px wide in 2000px space, modified by cropZoom
        const cropBoxWidth = Math.min(sourceWidth, (550 / cropZoom) * scaleTo2000);
        const cropBoxHeight = cropBoxWidth * (height / width);

        // Center crop on target coordinates with boundary clamping
        let cropX = normalizedTargetX - cropBoxWidth / 2;
        let cropY = normalizedTargetY - cropBoxHeight / 2;

        cropX = Math.max(0, Math.min(sourceWidth - cropBoxWidth, cropX));
        cropY = Math.max(0, Math.min(sourceHeight - cropBoxHeight, cropY));

        // Draw cropped floorplan slice onto destination canvas
        ctx.drawImage(
          sourceDrawable,
          cropX,
          cropY,
          cropBoxWidth,
          cropBoxHeight,
          0,
          0,
          width,
          height
        );

        // Subtly darken edges for high-contrast presentation
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, width, height);

        // Compute pin location on the destination canvas
        const pinCanvasX = ((normalizedTargetX - cropX) / cropBoxWidth) * width;
        const pinCanvasY = ((normalizedTargetY - cropY) / cropBoxHeight) * height;

        // ── Draw High-Contrast Target Reticle & Pin ──────────────────────────────
        const priority = (workOrder?.priority || 'medium').toLowerCase();
        let mainColor = '#2563eb'; // Blue default
        if (priority === 'urgent') mainColor = '#dc2626'; // Red
        else if (priority === 'high') mainColor = '#ea580c'; // Orange
        else if (priority === 'low') mainColor = '#059669'; // Green

        // 1. Crosshair lines extending from pin
        ctx.save();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(pinCanvasX - 32, pinCanvasY);
        ctx.lineTo(pinCanvasX + 32, pinCanvasY);
        ctx.moveTo(pinCanvasX, pinCanvasY - 32);
        ctx.lineTo(pinCanvasX, pinCanvasY + 32);
        ctx.stroke();
        ctx.restore();

        // 2. Outer pulse ring
        ctx.beginPath();
        ctx.arc(pinCanvasX, pinCanvasY, 22, 0, Math.PI * 2);
        ctx.fillStyle = priority === 'urgent' ? 'rgba(239, 68, 68, 0.18)' : 'rgba(37, 99, 235, 0.18)';
        ctx.fill();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Middle ring
        ctx.beginPath();
        ctx.arc(pinCanvasX, pinCanvasY, 11, 0, Math.PI * 2);
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 4. Center white bullseye dot
        ctx.beginPath();
        ctx.arc(pinCanvasX, pinCanvasY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // 5. Callout Label Pill
        if (showPinLabel && locationLabel) {
          ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const text = locationLabel;
          const textMetrics = ctx.measureText(text);
          const badgeWidth = textMetrics.width + 16;
          const badgeHeight = 22;
          const badgeY = pinCanvasY > 50 ? pinCanvasY - 34 : pinCanvasY + 28;

          // Shadow for badge
          ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;

          // Badge background
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(pinCanvasX - badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight, 6);
          } else {
            ctx.rect(pinCanvasX - badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight);
          }
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;

          // Badge border
          ctx.strokeStyle = mainColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Badge text
          ctx.fillStyle = '#ffffff';
          ctx.fillText(text, pinCanvasX, badgeY);
        }

        // Export data URL for 100% reliable print rendering
        const exportedUrl = canvas.toDataURL('image/png');
        setDataUrl(exportedUrl);
        setLoading(false);
      } catch (err) {
        console.error('Error rendering work order map crop:', err);
        if (isMounted) {
          setError('Failed to generate map image.');
          setLoading(false);
        }
      }
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [floorplan, targetX, targetY, hasCoordinates, width, height, cropZoom, showPinLabel, locationLabel, workOrder?.priority]);

  // If no coordinates or no floorplan, render high-clarity structured placeholder box
  if (!hasCoordinates || !floorplanId) {
    const siteTitle = workOrder?.site_name || 'Campus / Main Facility';
    const floorTitle = workOrder?.floorplan_name || 'General Building Area';
    const roomTitle = workOrder?.rooms?.[0]?.name ? `Room ${workOrder.rooms[0].name}` : (workOrder?.equipment?.[0]?.name || workOrder?.location_details || 'Unassigned Location');

    return (
      <div
        className={`wo-map-crop-placeholder ${className}`}
        style={{
          width: '100%',
          maxWidth: `${width}px`,
          height: `${height}px`,
          backgroundColor: '#f8fafc',
          border: '1.5px dashed #cbd5e1',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          textAlign: 'center',
          boxSizing: 'border-box',
          ...style
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3b82f6',
            marginBottom: '0.75rem'
          }}
        >
          <Building size={24} />
        </div>
        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.25rem' }}>
          {siteTitle} • {floorTitle}
        </div>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
          Location: {roomTitle}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8', maxWidth: '300px', lineHeight: 1.4 }}>
          No specific coordinates were pinned on the floorplan for this work order.
        </div>
      </div>
    );
  }

  const siteName = workOrder?.site_name || floorplan?.site?.name || floorplan?.site_name || '';
  const fpName = floorplan?.name || workOrder?.floorplan_name || '';
  const breadcrumb = [siteName, fpName].filter(Boolean).join(' • ');

  return (
    <div
      className={`wo-map-crop-container ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `${width}px`,
        aspectRatio: `${width} / ${height}`,
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #cbd5e1',
        backgroundColor: '#f8fafc',
        boxSizing: 'border-box',
        ...style
      }}
    >
      {/* Header Breadcrumb Tag (Top Left of Map) */}
      {breadcrumb && (
        <div
          className="wo-map-crop-tag"
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            backgroundColor: 'rgba(15, 23, 42, 0.90)',
            color: '#f8fafc',
            fontSize: '10px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '4px',
            maxWidth: 'calc(100% - 16px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            zIndex: 2,
            pointerEvents: 'none',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
            letterSpacing: '0.01em',
            lineHeight: '1.4'
          }}
          title={breadcrumb}
        >
          {breadcrumb}
        </div>
      )}

      {/* Canvas Element */}
      <canvas
        ref={canvasRef}
        style={{
          display: dataUrl ? 'none' : 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />

      {/* Static Image Element (Ensures 100% pixel fidelity in print engines) */}
      {dataUrl && (
        <img
          src={dataUrl}
          alt={`Cropped Map for ${workOrder?.order_number || 'Work Order'}`}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain'
          }}
        />
      )}

      {/* Loading Overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(248, 250, 252, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            color: '#64748b',
            fontSize: '0.8rem'
          }}
        >
          <Loader2 size={24} className="spinning" color="#3b82f6" />
          <span>Generating cropped map...</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && !loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            color: '#ef4444',
            fontSize: '0.8rem',
            padding: '1rem',
            textAlign: 'center'
          }}
        >
          <AlertCircle size={24} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
