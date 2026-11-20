import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDrawingWarp } from '../src/drawingWarp.js';

const pair = (x, y, u, v) => ({ target: { x, y }, source: { x: u, y: v } });
const project = (x, y) => [(0.8 * x + 0.04 * y + 0.04) / (1 + 0.18 * y), (0.86 * y + 0.03) / (1 + 0.18 * y)];
const anchors = [[10, 10], [90, 10], [90, 90], [10, 90]].map(([x, y]) => pair(x, y, ...project(x / 100, y / 100).map(value => value * 100)));
const near = (actual, expected) => actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-7));

test('four pairs recover perspective between landmarks', () => {
  near(fitDrawingWarp(anchors)(0.43, 0.62), project(0.43, 0.62));
});

test('a fifth pair corrects local drift without moving the four anchors', () => {
  const center = pair(50, 50, 49, 45);
  const warp = fitDrawingWarp([...anchors, center]);
  near(warp(0.5, 0.5), [0.49, 0.45]);
  for (const { target, source } of anchors) near(warp(target.x / 100, target.y / 100), [source.x / 100, source.y / 100]);
});

test('rejects duplicate, collinear and reversed pairs', () => {
  assert.equal(fitDrawingWarp([...anchors, anchors[0]]), null);
  assert.equal(fitDrawingWarp(anchors.map(({ source }, index) => pair(10 + index * 20, 50, source.x, source.y))), null);
  assert.equal(fitDrawingWarp(anchors.map(({ target, source }) => pair(target.x, target.y, 100 - source.x, source.y))), null);
});
