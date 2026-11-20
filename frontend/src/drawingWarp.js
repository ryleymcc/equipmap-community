export const MAX_DRAWING_MATCHES = 16;

function solve(matrix, values) {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  const n = rows.length;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-9) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let j = column; j <= n; j++) rows[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let j = column; j <= n; j++) rows[row][j] -= factor * rows[column][j];
    }
  }
  return rows.map(row => row[n]);
}

const normalize = point => [point.x / 100, point.y / 100];
const radialWeight = (x, y, u, v) => {
  const squared = (x - u) ** 2 + (y - v) ** 2;
  return squared ? squared * Math.log(squared) : 0;
};

export function fitDrawingWarp(matches) {
  if (matches.length < 4) return null;
  const targets = matches.map(pair => normalize(pair.target));
  const sources = matches.map(pair => normalize(pair.source));
  for (const points of [targets, sources]) {
    if (points.some(([x, y], i) => points.slice(0, i).some(([u, v]) => Math.hypot(x - u, y - v) < 0.001))) return null;
  }
  const anchors = targets.slice(0, 4);
  const equations = anchors.flatMap(([x, y], i) => {
    const [u, v] = sources[i];
    return [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]];
  });
  const coefficients = solve(equations, sources.slice(0, 4).flat());
  if (!coefficients) return null;
  const [a, b, c, d, e, f, g, h] = coefficients;
  const denominator = (x, y) => 1 + g * x + h * y;
  const sign = Math.sign(denominator(...anchors[0]));
  if (targets.some(point => denominator(...point) * sign < 1e-6)) return null;
  const perspective = (x, y) => {
    const divisor = denominator(x, y);
    return divisor * sign > 1e-6 ? [(a * x + b * y + c) / divisor, (d * x + e * y + f) / divisor] : null;
  };
  let warp = perspective;
  if (matches.length > 4) {
    // Thin-plate spline corrects local errors left by the perspective fit.
    const n = targets.length;
    const residuals = targets.map(([x, y], i) => perspective(x, y).map((value, axis) => sources[i][axis] - value));
    const matrix = targets.map(([x, y]) => [...targets.map(([u, v]) => radialWeight(x, y, u, v)), 1, x, y]);
    for (const values of [targets.map(() => 1), targets.map(point => point[0]), targets.map(point => point[1])]) matrix.push([...values, 0, 0, 0]);
    const weights = [0, 1].map(axis => solve(matrix, [...residuals.map(pair => pair[axis]), 0, 0, 0]));
    if (weights.some(weight => !weight)) return null;
    warp = (x, y) => perspective(x, y)?.map((value, axis) => {
      const weight = weights[axis];
      return targets.reduce((sum, [u, v], i) => sum + weight[i] * radialWeight(x, y, u, v), value + weight[n] + weight[n + 1] * x + weight[n + 2] * y);
    });
  }

  // Reject folds near landmarks and throughout the rectangle they span, where
  // it maps into the source. A negative determinant would mirror the drawing.
  const [xs, ys] = [0, 1].map(axis => targets.map(point => point[axis]));
  const bounds = [xs, ys].map(axis => [Math.min(...axis), Math.max(...axis)]);
  const samples = [...targets];
  for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) {
    samples.push(bounds.map(([min, max], axis) => min + (max - min) * (axis ? j : i) / 16));
  }
  for (const [x, y] of samples) {
    const point = warp(x, y);
    if (!point || point.some(value => value < -0.01 || value > 1.01)) continue;
    const right = warp(x + 0.0001, y), down = warp(x, y + 0.0001);
    if (!right || !down || (right[0] - point[0]) * (down[1] - point[1]) - (right[1] - point[1]) * (down[0] - point[0]) <= 1e-12) return null;
  }
  return warp;
}

export function paintDrawingWarp(source, output, warp, crop, width, height, region = { x: 0, y: 0, width: 1, height: 1 }) {
  // Bound raster work and use an inverse map so the preview has no tile seams.
  const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)));
  output.width = Math.max(1, Math.round(width * scale));
  output.height = Math.max(1, Math.round(height * scale));
  const context = output.getContext('2d');
  const pixels = source.data || source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
  const frame = context.createImageData(output.width, output.height);
  const meshSize = 96;
  const grid = Array.from({ length: meshSize + 1 }, (_, y) => Array.from({ length: meshSize + 1 }, (_, x) => warp(region.x + x / meshSize * region.width, region.y + y / meshSize * region.height)));
  const left = crop.x / 100, top = crop.y / 100, right = (crop.x + crop.width) / 100, bottom = (crop.y + crop.height) / 100;
  for (let y = 0; y < output.height; y++) {
    const gy = (y + 0.5) / output.height * meshSize, row = Math.floor(gy), dy = gy - row;
    for (let x = 0; x < output.width; x++) {
      const gx = (x + 0.5) / output.width * meshSize, col = Math.floor(gx), dx = gx - col;
      const a = grid[row][col], b = grid[row][col + 1], c = grid[row + 1][col], d = grid[row + 1][col + 1];
      if (!a || !b || !c || !d) continue;
      const u = (a[0] + (b[0] - a[0]) * dx) * (1 - dy) + (c[0] + (d[0] - c[0]) * dx) * dy;
      const v = (a[1] + (b[1] - a[1]) * dx) * (1 - dy) + (c[1] + (d[1] - c[1]) * dx) * dy;
      if (u < left || u >= right || v < top || v >= bottom) continue;
      const sx = u * (source.width - 1), sy = v * (source.height - 1);
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const dst = (y * output.width + x) * 4, src = (iy * source.width + ix) * 4;
      const nextX = ix + 1 < source.width ? 4 : 0, nextY = iy + 1 < source.height ? source.width * 4 : 0;
      for (let channel = 0; channel < 4; channel++) {
        const i = src + channel;
        frame.data[dst + channel] = (pixels[i] * (1 - fx) + pixels[i + nextX] * fx) * (1 - fy)
          + (pixels[i + nextY] * (1 - fx) + pixels[i + nextY + nextX] * fx) * fy;
      }
    }
  }
  context.putImageData(frame, 0, 0);
}
