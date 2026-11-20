// The source decoder may temporarily allocate the original image. Only the
// bounded derivative crosses to the UI thread; terminating this worker releases
// its source decode state on a floor switch.
self.onmessage = async ({ data: { url } }) => {
 const prepare = async () => {
  let bitmap;
  let stage = 'image.fetch';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Floorplan image unavailable (HTTP ${response.status})`);
    stage = 'image.decode';
    bitmap = await createImageBitmap(await response.blob());
    const quality = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height),
      Math.sqrt(4 * 1024 * 1024 / (bitmap.width * bitmap.height)));
    stage = 'image.resize';
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(bitmap.width * quality)), Math.max(1, Math.floor(bitmap.height * quality)));
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const logicalHeight = bitmap.height / bitmap.width * 2000;
    bitmap.close();
    bitmap = null;
    const result = canvas.transferToImageBitmap();
    self.postMessage({ bitmap: result, logicalHeight }, [result]);
  } catch (error) { self.postMessage({ error: error.message, name: error.name, stack: error.stack, stage }); }
  finally { bitmap?.close(); }
 };
 // Coordinate preparation across tabs when Web Locks is available. A worker
 // termination releases its lock, including when switching away mid-decode.
 if (navigator.locks) await navigator.locks.request('equipmap-floorplan-image-decode', prepare);
 else await prepare();
};
