import wasmUrl from "../node_modules/mupdf/dist/mupdf-wasm.wasm?url";

globalThis["$libmupdf_wasm_Module"] = {
  locateFile: (path) => {
    if (path.endsWith(".wasm")) {
      return wasmUrl;
    }
    return path;
  }
};

// Dynamically import mupdf after configuring the WASM module loader config
const mupdf = await import("mupdf");

let currentDoc = null;
let canvas = null;
let ctx = null;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === "INIT_CANVAS") {
    canvas = data.canvas;
    ctx = canvas.getContext("2d");
  }

  if (type === "LOAD_DOC") {
    try {
      const { buffer } = data;
      if (currentDoc) {
        currentDoc.destroy();
        currentDoc = null;
      }
      currentDoc = mupdf.Document.openDocument(buffer, "application/pdf");
      const numPages = currentDoc.countPages();

      // Load first page to get original dimensions
      const page = currentDoc.loadPage(0);
      const bounds = page.getBounds();
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];
      page.destroy();

      self.postMessage({
        type: "LOAD_DOC_SUCCESS",
        numPages,
        originalWidth: width,
        originalHeight: height,
      });
    } catch (err) {
      self.postMessage({ type: "LOAD_DOC_ERROR", error: err.message });
    }
  }

  if (type === "RENDER_PAGE") {
    try {
      if (!currentDoc) {
        throw new Error("No document loaded");
      }
      if (!canvas || !ctx) {
        throw new Error("Canvas not initialized in worker");
      }

      const { pageNum, scale } = data; // pageNum is 1-indexed
      const page = currentDoc.loadPage(pageNum - 1);

      const bounds = page.getBounds(); // [x0, y0, x1, y1]
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];

      // Calculate matrix based on scale
      const ctm = mupdf.Matrix.scale(scale, scale);

      const pixmap = page.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, true);
      const w = pixmap.getWidth();
      const h = pixmap.getHeight();

      // Resize offscreen canvas to match the rendered resolution
      canvas.width = w;
      canvas.height = h;

      const pixels = pixmap.getPixels();
      const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      const imgData = new ImageData(clamped, w, h);
      ctx.putImageData(imgData, 0, 0);

      pixmap.destroy();
      page.destroy();

      self.postMessage({
        type: "RENDER_PAGE_SUCCESS",
        pageNum,
        width: w,
        height: h,
        originalWidth: width,
        originalHeight: height,
      });
    } catch (err) {
      self.postMessage({ type: "RENDER_PAGE_ERROR", error: err.message });
    }
  }
};
