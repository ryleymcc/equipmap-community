import { useEffect, useRef } from 'react';
import { pdfjs } from 'react-pdf';
import { LOGICAL_WIDTH, PIXEL_BUDGET, PREVIEW_PIXEL_BUDGET, refinementDelay, visibleTiles } from './pdfTiles';
import './TiledFloorplan.css';
import { captureDiagnostic } from '../diagnostics.js';

export function TiledFloorplan({ url, transformRef, overlay, onLoad, onError, onParsed, pageNumber = 1 }) {
  const hostRef = useRef(null);
  const motionRef = useRef(null);
  const latest = useRef({ overlay, onLoad, onError, onParsed });
  useEffect(() => { latest.current = { overlay, onLoad, onError, onParsed }; });
  useEffect(() => { motionRef.current?.(); }, [overlay]);
  useEffect(() => {
    const host = hostRef.current;
    const map = host.closest('.map-content');
    let disposed = false;
    let task;
    let timer;
    let page;
    let preview;
    let previewReady = false;
    let front;
    let pending;
    let currentKey = '';
    let generation = 0;
    let changedAt = 0;
    let rendering = false;
    let renderMs;
    let lastWheelAt = 0;
    let inputGapMs = 0;
    let settleDelay = 150;
    let continuousInput = false;
    let stage = 'pdf.document';
    const startedAt = performance.now();
    const failureDetails = (failedStage = stage) => ({
      stage: failedStage, asset_url: url, worker_url: pdfjs.GlobalWorkerOptions.workerSrc,
      pdfjs_version: pdfjs.version, elapsed_ms: Math.round(performance.now() - startedAt),
      preview_ready: previewReady,
    });
    const stalled = setTimeout(() => {
      if (!disposed && !previewReady) captureDiagnostic(
        new Error('Floorplan PDF has not become ready after 45 seconds'), 'floorplan.stalled', failureDetails('pdf.stalled'), 'warning',
      );
    }, 45000);
    const continuousGestures = new Set();
    const wheelInput = () => {
      continuousInput = false;
      const now = performance.now();
      const gap = now - lastWheelAt;
      inputGapMs = lastWheelAt && gap < 400
        ? (inputGapMs ? inputGapMs * 0.6 + gap * 0.4 : gap) : 0;
      lastWheelAt = now;
    };
    let loading;
    try {
      loading = pdfjs.getDocument({ url, disableRange: true, disableStream: true, canvasMaxAreaInBytes: 16 * 1024 * 1024 });
    } catch (error) {
      clearTimeout(stalled);
      latest.current.onError(error, failureDetails());
      return;
    }
    const release = group => {
      if (!group) return;
      const canvases = group.tagName === 'CANVAS' ? [group] : group.querySelectorAll('canvas');
      for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
      group.remove();
      group.replaceChildren();
    };
    const schedule = delay => { clearTimeout(timer); timer = setTimeout(() => { void refine(); }, delay); };
    const motion = () => {
      if (disposed) return;
      generation++;
      changedAt = performance.now();
      if (changedAt - lastWheelAt > 400) inputGapMs = 0;
      settleDelay = continuousInput ? 0 : refinementDelay(renderMs, inputGapMs);
      host.dataset.refinementDelay = String(settleDelay);
      // The whole-page preview is already painted: this switch is synchronous
      // with the map transform, with no PDF work on the interaction path.
      host.dataset.detail = 'preview';
      if (rendering) task?.cancel();
      clearTimeout(timer);
      if (!continuousGestures.size) schedule(settleDelay);
    };
    const finishContinuous = () => {
      continuousGestures.clear();
      changedAt = performance.now();
      settleDelay = 0;
      host.dataset.refinementDelay = '0';
      schedule(0);
    };
    const cancelContinuous = () => {
      if (!disposed && continuousGestures.size) finishContinuous();
    };
    const gesture = ({ detail }) => {
      if (disposed) return;
      if (detail.phase === 'start') {
        // Keep any library alignment frames after release free of debounce too.
        continuousInput = true;
        // The library transfers from pan to pinch without emitting pan-stop.
        continuousGestures.clear();
        continuousGestures.add(detail.gesture);
      } else {
        continuousGestures.delete(detail.gesture);
        if (continuousGestures.size) return;
        // Pointer release gives an explicit end signal: no quiet-period wait.
        finishContinuous();
      }
    };
    const refine = async () => {
      if (disposed || !page || !previewReady || continuousGestures.size) return;
      if (rendering) { schedule(50); return; }
      const remaining = settleDelay - (performance.now() - changedAt);
      if (remaining > 0) { schedule(remaining); return; }
      const instance = transformRef.current?.instance;
      const state = instance?.state || transformRef.current?.state;
      const wrapper = instance?.wrapperComponent;
      if (!state || !wrapper) { schedule(50); return; }
      const unit = page.getViewport({ scale: 1 });
      const baseScale = LOGICAL_WIDTH / unit.width;
      const height = unit.height * baseScale;
      // Preview + completed detail + replacement detail share one fixed cap.
      const budget = (PIXEL_BUDGET - PREVIEW_PIXEL_BUDGET) / 2;
      const tiles = visibleTiles(height, state, { width: wrapper.clientWidth, height: wrapper.clientHeight }, latest.current.overlay, window.devicePixelRatio || 1, budget);
      const key = JSON.stringify(tiles);
      if (key === currentKey) { host.dataset.detail = 'ready'; return; }
      const revision = generation;
      rendering = true;
      const startedAt = performance.now();
      const batch = document.createElement('div');
      batch.className = 'floorplan-detail';
      pending = batch;
      let committed = false;
      try {
        for (const tile of tiles) {
          if (disposed || generation !== revision) return;
          const canvas = document.createElement('canvas');
          canvas.width = tile.width; canvas.height = tile.height;
          // Dynamic raster geometry preserves the existing logical coordinates.
          canvas.style.left = `${tile.x}px`; canvas.style.top = `${tile.y}px`;
          canvas.style.width = `${tile.width / tile.quality}px`;
          canvas.style.height = `${tile.height / tile.quality}px`;
          batch.append(canvas);
          task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false, willReadFrequently: true }),
            viewport: page.getViewport({ scale: baseScale * tile.quality }),
            transform: [1, 0, 0, 1, -tile.x * tile.quality, -tile.y * tile.quality] });
          await task.promise;
        }
        if (disposed || generation !== revision) return;
        host.replaceChildren(preview, batch);
        release(front);
        front = batch;
        currentKey = key;
        committed = true;
        if (tiles.length) {
          const elapsed = performance.now() - startedAt;
          renderMs = renderMs == null ? elapsed : renderMs * 0.7 + elapsed * 0.3;
        }
        host.dataset.detail = 'ready';
      } catch (error) {
        if (!disposed && error.name !== 'RenderingCancelledException') latest.current.onError(error, failureDetails('pdf.detail-render'));
      } finally {
        if (!committed) release(batch);
        pending = null;
        rendering = false;
        if (!disposed) page.cleanup();
      }
    };
    motionRef.current = motion;
    map?.addEventListener('equipmap-map-transform', motion);
    map?.addEventListener('equipmap-map-gesture', gesture);
    const resize = new ResizeObserver(motion);
    // Child effects can run before the transform instance initializes. Its
    // wrapper DOM already exists, so input listeners must not depend on that ref.
    const wrapper = transformRef.current?.instance?.wrapperComponent || map?.parentElement?.parentElement;
    if (wrapper) {
      resize.observe(wrapper);
      wrapper.addEventListener('wheel', wheelInput, { passive: true, capture: true });
      wrapper.addEventListener('touchcancel', cancelContinuous, { passive: true });
      wrapper.addEventListener('pointercancel', cancelContinuous, { passive: true });
    }
    window.addEventListener('blur', cancelContinuous);
    host.dataset.detail = 'preview';
    loading.promise.then(async pdf => {
      if (disposed) return;
      latest.current.onParsed?.(pdf);
      stage = 'pdf.page';
      page = await pdf.getPage(pageNumber);
      if (disposed) return;
      const unit = page.getViewport({ scale: 1 }); // includes intrinsic rotation
      const height = unit.height * LOGICAL_WIDTH / unit.width;
      host.style.height = `${height}px`;
      const quality = Math.min(1536 / Math.max(LOGICAL_WIDTH, height), Math.sqrt(PREVIEW_PIXEL_BUDGET / (LOGICAL_WIDTH * height)) * 0.98);
      preview = document.createElement('canvas');
      preview.className = 'floorplan-preview';
      preview.width = Math.max(1, Math.floor(LOGICAL_WIDTH * quality));
      preview.height = Math.max(1, Math.floor(height * quality));
      preview.style.width = `${LOGICAL_WIDTH}px`; preview.style.height = `${height}px`;
      stage = 'pdf.preview-render';
      task = page.render({ canvasContext: preview.getContext('2d', { alpha: false, willReadFrequently: true }),
        viewport: page.getViewport({ scale: preview.width / unit.width }) });
      await task.promise;
      if (disposed) return;
      previewReady = true;
      clearTimeout(stalled);
      host.append(preview);
      latest.current.onLoad();
      await refine();
    }).catch(error => { clearTimeout(stalled); if (!disposed) latest.current.onError(error, failureDetails()); });
    return () => {
      disposed = true;
      clearTimeout(stalled);
      motionRef.current = null;
      clearTimeout(timer);
      resize.disconnect();
      wrapper?.removeEventListener('wheel', wheelInput, { capture: true });
      wrapper?.removeEventListener('touchcancel', cancelContinuous);
      wrapper?.removeEventListener('pointercancel', cancelContinuous);
      window.removeEventListener('blur', cancelContinuous);
      map?.removeEventListener('equipmap-map-transform', motion);
      map?.removeEventListener('equipmap-map-gesture', gesture);
      task?.cancel();
      release(front);
      Promise.resolve(task?.promise).catch(() => {}).finally(() => { release(pending); release(preview); });
      void loading.destroy().catch(() => {});
    };
  }, [url, transformRef, pageNumber]);
  return <div ref={hostRef} className="floorplan-tiles" role="img" aria-label="Floorplan" />;
}
