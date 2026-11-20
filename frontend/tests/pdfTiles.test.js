import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleTiles, PIXEL_BUDGET, PREVIEW_PIXEL_BUDGET, refinementDelay, TILE_SIZE } from '../src/components/pdfTiles.js';
const state = { scale: 1, positionX: 0, positionY: 0 };
function bounded(tiles) {
  assert(tiles.length <= 16);
  assert(tiles.reduce((sum,t) => sum + t.width*t.height,0) <= PIXEL_BUDGET);
  for (const t of tiles) assert(t.width <= TILE_SIZE && t.height <= TILE_SIZE);
}
test('bounded raster allocation for zoom, aspect ratios, huge viewports and rotations', () => {
  for (const height of [1, 200, 2000, 2000000]) for (const scale of [0.5, 1, 100]) {
    for (const rotation of [0, 45, 90, 270]) {
      bounded(visibleTiles(height, { ...state, scale }, {width:20000,height:20000}, {tx:0,ty:0,rotation,scale:1}, 4));
    }
  }
});
test('offscreen page allocates nothing', () => {
  assert.deepEqual(visibleTiles(1000, {...state,positionX:5000}, {width:100,height:100}), []);
});
test('pan and calibration inverse transform preserve logical positions', () => {
  const tiles = visibleTiles(1000, {scale:2,positionX:-200,positionY:-400}, {width:200,height:200});
  assert.equal(tiles[0].x,100); assert.equal(tiles[0].y,200);
  const overlay = visibleTiles(1000,state,{width:100,height:100},{tx:100,ty:0,rotation:90,scale:1});
  assert(Math.abs(overlay[0].x) < 1e-10); assert(Math.abs(overlay[0].y) < 1e-10);
});

test('front and replacement batches share the original pixel budget', () => {
  for (const rotation of [0,45,90]) {
    const tiles = visibleTiles(200000, state, {width:10000,height:10000}, {tx:0,ty:0,rotation,scale:1}, 4, (PIXEL_BUDGET - PREVIEW_PIXEL_BUDGET) / 2);
    const pixels = tiles.reduce((sum,t)=>sum+t.width*t.height,0);
    assert(pixels * 2 + PREVIEW_PIXEL_BUDGET <= PIXEL_BUDGET);
  }
});

test('refinement adapts to measured render work and wheel cadence within bounds', () => {
  assert.equal(refinementDelay(undefined),150);
  assert.equal(refinementDelay(20),80);
  assert.equal(refinementDelay(400),200);
  assert.equal(refinementDelay(2000),300);
  assert.equal(refinementDelay(20,120),180);
  assert.equal(refinementDelay(20,1000),300);
});

test('vector detail follows high zoom without increasing viewport allocation', () => {
  const size = { width:1440, height:900 };
  const budget = (PIXEL_BUDGET - PREVIEW_PIXEL_BUDGET) / 2;
  for (const scale of [1,4,8,20,100]) {
    const tiles = visibleTiles(1500, {scale,positionX:0,positionY:0}, size, undefined, 1, budget);
    assert.equal(tiles[0].quality,scale);
    assert.equal(tiles.reduce((sum,t)=>sum+t.width*t.height,0),size.width*size.height);
    bounded(tiles);
  }
});

test('high zoom still respects dense-display and rotated-calibration budgets', () => {
  const budget = (PIXEL_BUDGET - PREVIEW_PIXEL_BUDGET) / 2;
  for (const scale of [8,20,100]) {
    for (const rotation of [0,35,90]) {
      const tiles = visibleTiles(1500, {scale,positionX:0,positionY:0}, {width:3840,height:2160}, {tx:0,ty:0,scale:2,rotation}, 2, budget);
      assert(tiles.length>0);
      assert(tiles[0].quality>4);
      const pixels=tiles.reduce((sum,t)=>sum+t.width*t.height,0);
      assert(pixels<=budget);
      assert(pixels*2+PREVIEW_PIXEL_BUDGET<=PIXEL_BUDGET);
      bounded(tiles);
    }
  }
});
