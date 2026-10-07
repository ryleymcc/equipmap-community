// Run with: node --test backend/tests/change_review_viewer.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function viewer(openai) {
  const nodes = new Map(); const listeners = new Map(); const messages = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = new Map(); this.attributes = {}; this.dataset = {}; }
    set id(id) { this._id = id; nodes.set(id, this); }
    get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.events.set(name, fn); }
    focus() { this.focused = true; }
    reportValidity() { return !this.required || !!this.value; }
    fire(name) { return this.events.get(name)?.({ preventDefault() {} }); }
  }
  for (const id of ['review-results', 'review-message', 'review-form', 'review-all', 'review-approve', 'review-cancel', 'review-refresh']) {
    const element = new Element('div'); element.id = id;
  }
  const document = { documentElement: { scrollHeight: 500 }, getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }), addEventListener() {} };
  const parent = { postMessage: message => messages.push(message) };
  const window = { parent, openai, addEventListener: (name, fn) => listeners.set(name, fn) };
  const context = vm.createContext({ window, document, URL, setTimeout() { return 1; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chatgpt_ui/review.js'), 'utf8'), context);
  return { nodes, messages, context,
    render(response) { context.response = response; vm.runInContext('render(response)', context); },
    message(data, source = parent) { listeners.get('message')({ source, data }); },
    selectAll() { const all = nodes.get('review-all'); all.checked = true; all.fire('change'); },
    async approve() { nodes.get('review-form').fire('submit'); await new Promise(resolve => setImmediate(resolve)); },
  };
}
function pending(id) { return { change_id: id, status: 'pending', preview: { kind: 'edit', record_name: `Fan ${id}`,
  context: 'Site / Floor', before: { description: 'Old note' }, after: { description: 'Proposed note' }, record_url: 'https://equipmap.example/map/1' } }; }
function response(...ids) { return { structuredContent: { results: ids.map(pending) }, _meta: { approval_tokens: Object.fromEntries(ids.map(id => [id, `private-${id}`])) } }; }

test('load and host rerender never submit; default selection is empty', () => {
  const app = viewer(); app.render(response('a', 'b')); app.render(response('a', 'b'));
  assert.equal(app.nodes.get('review-results').children.length, 2);
  assert.equal(app.nodes.get('review-approve').disabled, true);
  assert.equal(app.messages.filter(item => item.method === 'tools/call').length, 0);
});

test('standard bridge sends one selected batch with edited fields and guards double submission', async () => {
  const app = viewer(); app.message({ id: 1, result: {} }); app.render(response('a', 'b')); app.selectAll();
  const field = app.nodes.get('a-description'); field.value = 'Edited in chat'; field.fire('input');
  await app.approve(); await app.approve();
  const calls = app.messages.filter(item => item.method === 'tools/call');
  assert.equal(calls.length, 1); assert.equal(calls[0].params.name, 'submit_change_reviews');
  const decisions = calls[0].params.arguments.decisions;
  assert.equal(decisions.length, 2); assert.equal(decisions[0].changes.description, 'Edited in chat');
  assert.equal(decisions[0].approval_token, 'private-a');
  app.message({ id: calls[0].id, result: { structuredContent: { results: [
    { ...pending('a'), status: 'applied', audit_id: 42 }, { change_id: 'b', status: 'error', error: 'Stale record' },
  ] } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.nodes.get('review-results').children.length, 2);
  assert.match(app.nodes.get('review-message').textContent, /could not be saved/);
  assert.equal(app.nodes.get('review-message').focused, true);
});

test('legacy bridge reads nested private metadata and preserves unselected proposals', async () => {
  const calls = []; const result = response('a', 'b');
  const app = viewer({ toolOutput: result.structuredContent, toolResponseMetadata: { mcp_tool_result: result },
    callTool: async (name, args) => { calls.push({ name, args }); return { structuredContent: { results: [{ ...pending('a'), status: 'applied', audit_id: 5 }] } }; },
  });
  const first = app.nodes.get('review-results').children[0].children[0].children[0].children[0];
  first.checked = true; first.fire('change'); await app.approve();
  assert.equal(calls.length, 1); assert.equal(calls[0].args.decisions.length, 1);
  assert.equal(calls[0].args.decisions[0].change_id, 'a');
  assert.equal(app.nodes.get('review-results').children.length, 2);
  assert.equal(app.nodes.get('review-approve').disabled, true);
});

test('missing private capability disables approvals and untrusted frame messages are ignored', () => {
  const app = viewer(); app.message({ id: 1, result: {} });
  app.message({ method: 'ui/notifications/tool-result', params: response('forged') }, {});
  assert.equal(app.nodes.get('review-results').children.length, 0);
  app.render({ structuredContent: { results: [pending('a')] } }); app.selectAll();
  assert.equal(app.nodes.get('review-approve').disabled, true);
});

test('empty and tool-level error states remain readable', () => {
  const app = viewer(); app.render(response());
  assert.match(app.nodes.get('review-message').textContent, /No pending/);
  app.render({ structuredContent: { error: 'Connection revoked' } });
  assert.equal(app.nodes.get('review-message').attributes.role, 'alert');
  assert.equal(app.nodes.get('review-message').textContent, 'Connection revoked');
});
