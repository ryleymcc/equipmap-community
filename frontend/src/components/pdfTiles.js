export const LOGICAL_WIDTH = 2000;
export const PIXEL_BUDGET = 4 * 1024 * 1024;
export const PREVIEW_PIXEL_BUDGET = 512 * 1024;
export const TILE_SIZE = 768;

// Invert the calibration transform after the map's pan/zoom. All geometry stays
// in the historic 2000-unit page space, independent of raster resolution.
export function visibleTiles(height, state, size, overlay, dpr = 1, pixelBudget = PIXEL_BUDGET) {
  const { scale, positionX, positionY } = state;
  const t = overlay || { tx: 0, ty: 0, rotation: 0, scale: 1 };
  if (!(scale > 0 && t.scale > 0 && height > 0 && size.width > 0 && size.height > 0)) return [];
  const angle = -t.rotation * Math.PI / 180;
  const corners = [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]].map(([x, y]) => {
    const dx = (x - positionX) / scale - t.tx;
    const dy = (y - positionY) / scale - t.ty;
    return [(dx * Math.cos(angle) - dy * Math.sin(angle)) / t.scale,
      (dx * Math.sin(angle) + dy * Math.cos(angle)) / t.scale];
  });
  const left = Math.max(0, Math.min(...corners.map(p => p[0])));
  const top = Math.max(0, Math.min(...corners.map(p => p[1])));
  const right = Math.min(LOGICAL_WIDTH, Math.max(...corners.map(p => p[0])));
  const bottom = Math.min(height, Math.max(...corners.map(p => p[1])));
  if (right <= left || bottom <= top) return [];
  // Cap total allocation, including ceil rounding, even for huge viewports or
  // very tall scanned pages. A grid of at most 4x4 tiles bounds tile overhead.
  // Increase detail with zoom. Bound the rasterized viewport's pixels instead
  // of imposing a page-space scale ceiling that blurs vector PDFs up close.
  const quality = Math.min(scale * t.scale * Math.min(dpr, 2),
    3072 / Math.max(right - left, bottom - top),
    Math.sqrt(Math.min(pixelBudget, PIXEL_BUDGET) / ((right - left) * (bottom - top))) * 0.98);
  const width = Math.ceil((right - left) * quality);
  const pixelsHigh = Math.ceil((bottom - top) * quality);
  const tiles = [];
  for (let y = 0; y < pixelsHigh; y += TILE_SIZE) {
    for (let x = 0; x < width; x += TILE_SIZE) {
      tiles.push({ x: left + x / quality, y: top + y / quality, quality,
        width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, pixelsHigh - y) });
    }
  }
  return tiles;
}

// Use measured work, not CPU core count: PDF complexity and current machine
// load both matter. Input cadence prevents work between closely spaced notches.
export function refinementDelay(renderMs, inputGapMs = 0) {
  const work = Number.isFinite(renderMs) ? renderMs * 0.5 : 150;
  return Math.round(Math.min(300, Math.max(80, work, inputGapMs * 1.5)));
}
