import { useEffect, useRef } from 'react';
import './TiledFloorplan.css';
import { captureDiagnostic } from '../diagnostics.js';

export function BoundedImageFloorplan({ url, onLoad, onError }) {
  const canvasRef = useRef(null);
  const latest = useRef({ onLoad, onError });
  useEffect(() => { latest.current = { onLoad, onError }; });
  useEffect(() => {
    const canvas = canvasRef.current;
    let worker;
    try {
      worker = new Worker(new URL('./floorplanImage.worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      latest.current.onError(error, { stage: 'image.worker-create', asset_url: url });
      return;
    }
    let disposed = false;
    const startedAt = performance.now();
    const details = stage => ({ stage, asset_url: url, elapsed_ms: Math.round(performance.now() - startedAt) });
    const stalled = setTimeout(() => {
      if (!disposed) captureDiagnostic(new Error('Floorplan image has not become ready after 45 seconds'),
        'floorplan.stalled', details('image.worker-wait'), 'warning');
    }, 45000);
    worker.onmessage = ({ data }) => {
      clearTimeout(stalled);
      if (data.error) {
        const error = new Error(data.error);
        error.name = data.name || 'Error';
        if (data.stack) error.stack = data.stack;
        if (!disposed) latest.current.onError(error, details(data.stage || 'image.decode'));
        worker.terminate(); return;
      }
      try {
        if (disposed) return;
        canvas.width = data.bitmap.width;
        canvas.height = data.bitmap.height;
        canvas.style.height = `${data.logicalHeight}px`;
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(data.bitmap, 0, 0);
        latest.current.onLoad();
      } catch (error) {
        if (!disposed) latest.current.onError(error, details('image.canvas'));
      } finally { data.bitmap.close(); worker.terminate(); }
    };
    worker.onerror = event => {
      clearTimeout(stalled);
      if (!disposed) latest.current.onError(event.error || new Error(event.message || 'Image worker failed'), {
        ...details('image.worker'), worker_file: event.filename, worker_line: event.lineno,
      });
      worker.terminate();
    };
    worker.postMessage({ url });
    return () => { disposed = true; clearTimeout(stalled); worker.terminate(); canvas.width = 0; canvas.height = 0; };
  }, [url]);
  return <canvas ref={canvasRef} className="floorplan-image" role="img" aria-label="Floorplan" />;
}
