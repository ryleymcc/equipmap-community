/**
 * Cross-floorplan alignment utilities.
 *
 * Given two reference points on a source floorplan and two on a destination,
 * computes a similarity transform (uniform scale + rotation + translation)
 * that maps pixel coordinates from one floorplan to the other.
 */

/**
 * Compute a similarity transform from source ref points to destination ref points.
 *
 * @param {Array} srcRefPoints - [{label, x_coordinate, y_coordinate}, ...] (must have A and B)
 * @param {Array} dstRefPoints - [{label, x_coordinate, y_coordinate}, ...] (must have A and B)
 * @returns {Object|null} Transform object {scale, rotation, tx, ty} or null if invalid
 */
export function computeTransform(srcRefPoints, dstRefPoints) {
  const srcA = srcRefPoints.find(p => p.label === 'A');
  const srcB = srcRefPoints.find(p => p.label === 'B');
  const dstA = dstRefPoints.find(p => p.label === 'A');
  const dstB = dstRefPoints.find(p => p.label === 'B');

  if (!srcA || !srcB || !dstA || !dstB) return null;

  // Source vector: B - A
  const svx = srcB.x_coordinate - srcA.x_coordinate;
  const svy = srcB.y_coordinate - srcA.y_coordinate;
  const srcLen = Math.sqrt(svx * svx + svy * svy);

  // Destination vector: B - A
  const dvx = dstB.x_coordinate - dstA.x_coordinate;
  const dvy = dstB.y_coordinate - dstA.y_coordinate;
  const dstLen = Math.sqrt(dvx * dvx + dvy * dvy);

  if (srcLen < 1e-6 || dstLen < 1e-6) return null; // Points too close together

  const scale = dstLen / srcLen;
  const srcAngle = Math.atan2(svy, svx);
  const dstAngle = Math.atan2(dvy, dvx);
  const rotation = dstAngle - srcAngle;

  // Translation: after scaling and rotating srcA, it should land on dstA
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const tx = dstA.x_coordinate - scale * (cosR * srcA.x_coordinate - sinR * srcA.y_coordinate);
  const ty = dstA.y_coordinate - scale * (sinR * srcA.x_coordinate + cosR * srcA.y_coordinate);

  return { scale, rotation, tx, ty };
}

/**
 * Apply a similarity transform to a point.
 *
 * @param {Object} transform - {scale, rotation, tx, ty}
 * @param {number} x - Source x coordinate
 * @param {number} y - Source y coordinate
 * @returns {Object} {x, y} in destination space
 */
export function applyTransform(transform, x, y) {
  const { scale, rotation, tx, ty } = transform;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  return {
    x: scale * (cosR * x - sinR * y) + tx,
    y: scale * (sinR * x + cosR * y) + ty
  };
}

/**
 * Compute the inverse transform (destination → source).
 *
 * @param {Object} transform - {scale, rotation, tx, ty}
 * @returns {Object} Inverse transform {scale, rotation, tx, ty}
 */
export function invertTransform(transform) {
  const { scale, rotation, tx, ty } = transform;
  const invScale = 1 / scale;
  const invRotation = -rotation;
  const cosR = Math.cos(invRotation);
  const sinR = Math.sin(invRotation);
  const invTx = invScale * (cosR * (-tx) - sinR * (-ty));
  const invTy = invScale * (sinR * (-tx) + cosR * (-ty));
  return { scale: invScale, rotation: invRotation, tx: invTx, ty: invTy };
}

/**
 * Generate reference points for an overlay floorplan given its visual transform
 * relative to a base floorplan, and the base floorplan's reference points.
 *
 * If baseRefPoints is empty, it assigns default points (0,0) and (1000,0) to the base.
 * Returns both the base points (in case they were generated) and the computed overlay points.
 *
 * @param {Object} visualTransform - {scale, rotation, tx, ty} mapping overlay to base
 * @param {Array} baseRefPoints - Existing reference points for the base floorplan
 * @returns {Object} { basePoints: Array, overlayPoints: Array }
 */
export function generateRefPointsFromTransform(visualTransform, baseRefPoints) {
  let baseA, baseB;

  if (!baseRefPoints || baseRefPoints.length !== 2) {
    // Generate arbitrary default points for the base floorplan
    baseA = { label: 'A', x_coordinate: 0, y_coordinate: 0 };
    baseB = { label: 'B', x_coordinate: 1000, y_coordinate: 0 };
  } else {
    baseA = baseRefPoints.find(p => p.label === 'A');
    baseB = baseRefPoints.find(p => p.label === 'B');
  }

  // The visual transform maps Overlay -> Base.
  // We want to find the coordinates on the Overlay that map to baseA and baseB.
  // So we apply the inverse transform to baseA and baseB.
  const invTransform = invertTransform(visualTransform);

  const overA = applyTransform(invTransform, baseA.x_coordinate, baseA.y_coordinate);
  const overB = applyTransform(invTransform, baseB.x_coordinate, baseB.y_coordinate);

  const overlayPoints = [
    { label: 'A', x_coordinate: overA.x, y_coordinate: overA.y },
    { label: 'B', x_coordinate: overB.x, y_coordinate: overB.y }
  ];

  return {
    basePoints: [baseA, baseB],
    overlayPoints
  };
}
