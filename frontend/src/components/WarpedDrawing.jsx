import { useEffect, useRef } from 'react';
import { paintDrawingWarp } from '../drawingWarp';

export default function WarpedDrawing({ source, warp, matches, crop, size, opacity, url, title, transformRef }) {
  const host = useRef(null);
  const overview = useRef(null);
  const detail = useRef(null);

  useEffect(() => {
    const original = source.current?.querySelector('canvas');
    if (original?.width) paintDrawingWarp(original, overview.current, warp, crop, Math.min(size.width, 1600), Math.min(size.width, 1600) * size.height / size.width);
  }, [source, warp, crop, size]);

  useEffect(() => {
    const layer = host.current;
    const canvas = detail.current;
    const map = layer.closest('.map-content');
    const wrapper = transformRef.current?.instance?.wrapperComponent || map?.parentElement?.parentElement;
    if (!wrapper || !map || !size.width || !size.height) return;
    let worker;
    try { worker = new Worker(new URL('./drawingDetail.worker.js', import.meta.url), { type: 'module' }); }
    catch { return; }
    let timer;
    let revision = 0;
    let busy = false;
    let queued = false;
    const render = () => {
      if (busy) { queued = true; return; }
      const bounds = layer.getBoundingClientRect();
      const viewport = wrapper.getBoundingClientRect();
      const left = Math.max(bounds.left, viewport.left), top = Math.max(bounds.top, viewport.top);
      const width = Math.min(bounds.right, viewport.right) - left;
      const height = Math.min(bounds.bottom, viewport.bottom) - top;
      if (width <= 0 || height <= 0) return;
      const density = window.devicePixelRatio || 1;
      const region = { x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height, width: width / bounds.width, height: height / bounds.height };
      busy = true;
      worker.postMessage({ id: revision, crop, region, width: width * density, height: height * density });
    };
    const schedule = () => {
      revision++;
      layer.dataset.detail = 'preview';
      queued = false;
      clearTimeout(timer);
      timer = setTimeout(render, 120);
    };
    worker.onmessage = ({ data }) => {
      busy = false;
      const { bitmap, region } = data;
      if (bitmap) {
        if (data.id === revision) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          canvas.style.left = `${region.x * 100}%`;
          canvas.style.top = `${region.y * 100}%`;
          canvas.style.width = `${region.width * 100}%`;
          canvas.style.height = `${region.height * 100}%`;
          layer.dataset.detail = 'ready';
        }
        bitmap.close();
      }
      if (queued) { queued = false; render(); }
    };
    worker.postMessage({ url, matches });
    const resize = new ResizeObserver(schedule);
    resize.observe(wrapper);
    map.addEventListener('equipmap-map-transform', schedule);
    schedule();
    return () => {
      clearTimeout(timer);
      worker.terminate();
      resize.disconnect();
      map.removeEventListener('equipmap-map-transform', schedule);
    };
  }, [url, matches, crop, size, transformRef]);

  return <div ref={host} className="drawing-match-output" style={{ opacity: opacity / 100 }} role="img" aria-label={`Warped drawing: ${title}`}>
    <canvas ref={overview} className="drawing-match-overview" />
    <canvas ref={detail} className="drawing-match-detail" />
  </div>;
}
