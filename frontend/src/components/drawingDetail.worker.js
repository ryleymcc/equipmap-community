import { fitDrawingWarp, paintDrawingWarp } from '../drawingWarp';

async function loadSource(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Drawing image unavailable');
  const image = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, 8192 / Math.max(image.width, image.height), Math.sqrt(16_000_000 / (image.width * image.height)));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    image.close();
  }
}

let sourcePromise;
let warp;
self.onmessage = async ({ data }) => {
  if (data.url) {
    warp = fitDrawingWarp(data.matches);
    sourcePromise = loadSource(data.url).catch(() => null);
    return;
  }
  try {
    const source = await sourcePromise;
    if (!source || !warp) throw new Error('Drawing detail unavailable');
    const canvas = new OffscreenCanvas(1, 1);
    paintDrawingWarp(source, canvas, warp, data.crop, data.width, data.height, data.region);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id: data.id, bitmap, region: data.region }, [bitmap]);
  } catch {
    self.postMessage({ id: data.id, failed: true });
  }
};
