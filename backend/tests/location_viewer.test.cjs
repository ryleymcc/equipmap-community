// Run with: node --test backend/tests/location_viewer.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function viewer(globals) {
  const children = [];
  const status = {};
  const locations = {
    replaceChildren() { children.length = 0; },
    append(child) { children.push(child); },
    hasChildNodes() { return children.length > 0; },
  };
  const template = { content: { cloneNode() {
    const elements = Object.fromEntries(['title', 'context', 'message', 'image', 'caption', 'link'].map(
      name => [`.location-${name}`, { hidden: ['image', 'caption', 'link'].includes(name), addEventListener() {} }]));
    return { elements, querySelector: selector => elements[selector] };
  } } };
  const window = { parent: { postMessage() {} }, addEventListener() {}, openai: globals };
  const document = {
    documentElement: { scrollHeight: 100 }, addEventListener() {},
    getElementById: id => ({ 'location-status': status, 'location-results': locations, 'location-template': template })[id],
  };
  const context = vm.createContext({ window, document, URL, setInterval() {}, clearInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chatgpt_ui/location.js'), 'utf8'), context);
  return { children, render: result => { context.input = result; vm.runInContext('render(input)', context); } };
}

const record = id => ({ id, type: 'equipment', name: `Fan ${id}`, floorplan_name: 'Level 1', url: `https://equipmap.example/map/1?highlightId=${id}` });
const included = (id, index) => ({ record: record(id), image_status: 'included', presentation: { image_index: index, image_ready: true } });
const png = 'YWJj'; // Image validity is covered by the real renderer/browser tests.

test('skipped and failed entries never reuse the first image', () => {
  const app = viewer();
  app.render({ structuredContent: { results: [included(1, 0),
    { record: record(2), image_status: 'skipped', image_skip_reason: 'limit' },
    { record: record(3), image_status: 'error', image_error: 'Unavailable' }] },
    _meta: { images: [{ image_index: 0, imagePng: png }] }, content: [{ type: 'image', data: png }] });
  assert.equal(app.children[0].elements['.location-image'].hidden, false);
  for (const child of app.children.slice(1)) {
    assert.equal(child.elements['.location-image'].hidden, true);
    assert.equal(child.elements['.location-image'].src, undefined);
  }
});

test('image-only content fallback uses explicit indexes, including after a failure', () => {
  const app = viewer();
  app.render({ structuredContent: { results: [{ record: record(1), image_status: 'error' }, included(2, 0), included(3, 1)] },
    content: [{ type: 'image', data: 'YWJj' }, { type: 'image', data: 'ZGVm' }] });
  assert.equal(app.children[0].elements['.location-image'].hidden, true);
  assert.equal(app.children[1].elements['.location-image'].src, 'data:image/png;base64,YWJj');
  assert.equal(app.children[2].elements['.location-image'].src, 'data:image/png;base64,ZGVm');
});

test('legacy single image and repeated host events keep one record view', () => {
  const app = viewer();
  const response = { structuredContent: { record: record(1) }, _meta: { imagePng: png } };
  app.render(response);
  app.render(response);
  assert.equal(app.children.length, 1);
  assert.equal(app.children[0].elements['.location-image'].src, 'data:image/png;base64,YWJj');
});

test('unindexed entries cannot use single-image metadata or stale globals', () => {
  const app = viewer();
  app.render({ structuredContent: { results: [{ ...record(1), image_status: 'skipped' }] }, _meta: { imagePng: png } });
  assert.equal(app.children[0].elements['.location-image'].hidden, true);
});

for (const key of ['mcp_tool_result', 'call_tool_result']) {
  test(`ChatGPT nested ${key} metadata supplies the crop without a second call`, () => {
    const result = { structuredContent: { results: [included(1, 0)] },
      _meta: { images: [{ image_index: 0, imagePng: png }] } };
    const app = viewer({ toolOutput: result.structuredContent, toolResponseMetadata: { status: 'complete', [key]: result } });
    assert.equal(app.children.length, 1);
    assert.equal(app.children[0].elements['.location-image'].src, `data:image/png;base64,${png}`);
  });
}

test('current MCP envelope takes precedence over previous ChatGPT globals', () => {
  const previous = { structuredContent: { results: [included(1, 0)] },
    _meta: { images: [{ image_index: 0, imagePng: png }] } };
  const app = viewer({ toolOutput: previous.structuredContent, toolResponseMetadata: { mcp_tool_result: previous } });
  app.render({ structuredContent: { results: [included(2, 0)] }, content: [{ type: 'image', data: 'ZGVm' }] });
  assert.equal(app.children[0].elements['.location-image'].src, 'data:image/png;base64,ZGVm');
});
