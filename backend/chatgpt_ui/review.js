/* No approval occurs on load: only the user's explicit form action submits. */
const container = document.getElementById('review-results');
const message = document.getElementById('review-message');
const form = document.getElementById('review-form');
const selectAll = document.getElementById('review-all');
const approveButton = document.getElementById('review-approve');
const cancelButton = document.getElementById('review-cancel');
const refreshButton = document.getElementById('review-refresh');
const entries = new Map();
const tokens = new Map();
const requests = new Map();
let initialized = false;
let busy = false;
let received = false;
let nextId = 2;
let lastHeight = 0;
let lastInitialized = false;

function resize() {
  const panel = document.querySelector?.('.review-panel');
  const padding = panel ? getComputedStyle(document.body) : null;
  const height = panel ? Math.ceil(panel.getBoundingClientRect().height + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom)) : document.documentElement.scrollHeight;
  if (!initialized && typeof window.openai?.notifyIntrinsicHeight !== 'function') return;
  if (height === lastHeight && initialized === lastInitialized) return;
  lastHeight = height;
  lastInitialized = initialized;
  if (initialized) window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } }, '*');
  window.openai?.notifyIntrinsicHeight?.(height);
}

function output(response) {
  let data = response?.structuredContent ?? response;
  if (!data?.results && !data?.error && response?.content) {
    for (const item of response.content) {
      if (item.type !== 'text') continue;
      try { const parsed = JSON.parse(item.text); if (parsed.results || parsed.error) data = parsed; } catch { /* Text may be delivery guidance. */ }
    }
  }
  return data;
}

function controls() {
  const pending = [...entries.values()].filter((entry) => entry.status === 'pending' && tokens.has(entry.change_id));
  const selected = pending.filter((entry) => entry.selected);
  const ready = initialized || typeof window.openai?.callTool === 'function';
  selectAll.disabled = busy || !pending.length;
  selectAll.checked = pending.length > 0 && selected.length === pending.length;
  selectAll.indeterminate = selected.length > 0 && selected.length < pending.length;
  approveButton.disabled = cancelButton.disabled = busy || !ready || !selected.length;
  approveButton.textContent = busy ? 'Submitting…' : `Approve selected (${selected.length})`;
  refreshButton.disabled = busy || !ready;
  form.setAttribute('aria-busy', String(busy));
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function draw() {
  container.replaceChildren();
  for (const entry of entries.values()) {
    const preview = entry.preview ?? {};
    const section = element('section', undefined, 'review-entry');
    const label = element('label', undefined, 'review-check');
    const check = element('input');
    check.type = 'checkbox'; check.checked = !!entry.selected;
    check.disabled = busy || entry.status !== 'pending' || !tokens.has(entry.change_id);
    check.addEventListener('change', () => { entry.selected = check.checked; section.dataset.selected = String(check.checked); controls(); });
    const heading = element('h2', preview.record_name ?? entry.change_id);
    heading.id = `title-${entry.change_id}`;
    section.setAttribute('aria-labelledby', heading.id);
    label.append(check, element('span', preview.record_name ?? entry.change_id));
    heading.replaceChildren(label); section.append(heading);
    section.dataset.selected = String(!!entry.selected);
    const action = preview.kind === 'edit' ? `Update ${preview.record_type ?? 'equipment'} details` : `${preview.operation === 'remove' ? 'Remove' : 'Add'} equipment relationship`;
    section.append(element('p', `${action} · ${preview.context ?? ''}`, 'location-context'));
    if (entry.status !== 'pending') section.append(element('p', `Status: ${entry.status}`));
    if (entry.status === 'pending' && !tokens.has(entry.change_id)) section.append(element('p', `Only ${entry.username ?? 'the requesting account'} can approve this change.`, 'location-context'));
    const fields = element('div', undefined, 'review-fields');
    const editable = entry.status === 'pending';
    const values = preview.kind === 'edit' ? preview.after ?? {} : { relationship: preview.after?.relationship };
    for (const [field, proposed] of Object.entries(values)) {
      const group = element('div', undefined, `review-field${field === 'description' || field === 'relationship' ? ' review-field-wide' : ''}`);
      const title = field.replaceAll('_', ' ');
      const fieldLabel = element('label', title.charAt(0).toUpperCase() + title.slice(1));
      const input = element(field === 'name' ? 'input' : 'textarea');
      if (field === 'name') input.type = 'text';
      input.id = `${entry.change_id}-${field}`; fieldLabel.htmlFor = input.id;
      input.value = entry.values?.[field] ?? proposed ?? '';
      if (entry.values?.[field] === null) input.value = '';
      input.disabled = busy || !editable;
      input.maxLength = field === 'name' ? 200 : field === 'tools_required' ? 4000 : 8000;
      if (field === 'name') input.required = true;
      if (field !== 'name') input.rows = 2;
      input.addEventListener('input', () => { entry.values[field] = field === 'name' || input.value !== '' ? input.value : null; });
      if (field === 'relationship') {
        input.disabled = true;
      }
      group.append(fieldLabel, input); fields.append(group);
    }
    if (preview.kind === 'relationship' && preview.operation === 'add') {
      const label = element('label', 'Relationship details'); const input = element('textarea');
      input.id = `${entry.change_id}-detail`; label.htmlFor = input.id;
      input.value = entry.detail ?? preview.detail ?? ''; input.maxLength = 2000; input.disabled = busy || !editable;
      input.rows = 2;
      input.addEventListener('input', () => { entry.detail = input.value; });
      const group = element('div', undefined, 'review-field review-field-wide'); group.append(label, input); fields.append(group);
    }
    section.append(fields);
    const current = element('details', undefined, 'review-current');
    current.append(element('summary', 'Show current values'));
    const list = element('dl');
    for (const [field, value] of Object.entries(preview.before ?? {})) {
      const group = element('div'); group.append(element('dt', field.replaceAll('_', ' ')), element('dd', value ?? '(empty)')); list.append(group);
    }
    current.append(list); current.addEventListener('toggle', resize); section.append(current);
    if (entry.error) section.append(element('p', `Not saved: ${entry.error}`, 'review-error'));
    if (entry.status === 'applied') section.append(element('p', `Saved · Audit entry #${entry.audit_id}`, 'review-success'));
    try {
      const url = new URL(preview.record_url);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        const link = element('a', 'View record in EquipMap', 'location-context');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link);
      }
    } catch { /* Records without a valid navigation URL still remain reviewable. */ }
    container.append(section);
  }
  controls(); resize();
}

function render(response, privateMeta = window.openai?.toolResponseMetadata) {
  const hostMetadata = response?.metadata ?? privateMeta ?? {};
  const envelope = response?.structuredContent ? response : hostMetadata.mcp_tool_result ?? hostMetadata.call_tool_result ?? response;
  const data = output(envelope);
  if (!data || (!data.results && !data.error)) return;
  received = true;
  if (data.error) { message.textContent = data.error; message.setAttribute('role', 'alert'); resize(); return; }
  const metadata = envelope?._meta ?? hostMetadata;
  for (const [id, token] of Object.entries(metadata.approval_tokens ?? {})) tokens.set(id, token);
  entries.clear();
  for (const entry of data.results) entries.set(entry.change_id, { ...entry, selected: false, values: { ...entry.preview?.after } });
  message.textContent = entries.size ? `${entries.size} ${entries.size === 1 ? 'change' : 'changes'} ready for review. Only checked changes will be saved.` : 'No pending changes for this connection.';
  message.setAttribute('role', 'status'); draw();
}

function callTool(name, args) {
  if (!initialized && typeof window.openai?.callTool === 'function') return window.openai.callTool(name, args);
  if (!initialized) return Promise.reject(new Error('The chat host has not connected the review form.'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { requests.delete(id); reject(new Error('No confirmation received. Refresh to check status before retrying.')); }, 30000);
    requests.set(id, { resolve, reject, timeout });
    window.parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, '*');
  });
}

async function submit(approve) {
  if (busy) return;
  const selected = [...entries.values()].filter((entry) => entry.selected && entry.status === 'pending' && tokens.has(entry.change_id));
  if (!selected.length) return;
  if (approve) {
    for (const entry of selected) {
      if (entry.preview.kind !== 'edit') continue;
      for (const field of Object.keys(entry.values)) {
        const input = document.getElementById(`${entry.change_id}-${field}`);
        if (input && !input.disabled && !input.reportValidity()) return;
      }
    }
  }
  const decisions = selected.map((entry) => {
    const decision = { change_id: entry.change_id, approval_token: tokens.get(entry.change_id), approve };
    if (approve && entry.preview.kind === 'edit') decision.changes = entry.values;
    if (approve && entry.preview.kind === 'relationship' && entry.preview.operation === 'add') decision.detail = entry.detail ?? entry.preview.detail;
    return decision;
  });
  busy = true; draw(); message.textContent = 'Submitting selected changes…';
  try {
    const data = output(await callTool('submit_change_reviews', { decisions }));
    if (data?.error || !Array.isArray(data?.results)) throw new Error(data?.error ?? 'The host did not return change statuses. Refresh before retrying.');
    for (const result of data.results) {
      const entry = entries.get(result.change_id); if (!entry) continue;
      if (result.status === 'error') entry.error = result.error;
      else { Object.assign(entry, result, { selected: false, error: null, values: { ...result.preview?.after } }); if (result.status !== 'pending') tokens.delete(result.change_id); }
    }
    const errors = data.results.filter((entry) => entry.status === 'error').length;
    message.textContent = errors ? `${errors} selected change(s) could not be saved. Review the errors below.` : `Selected changes ${approve ? 'saved' : 'cancelled'}.`;
    message.setAttribute('role', errors ? 'alert' : 'status');
  } catch (error) { message.textContent = error.message; message.setAttribute('role', 'alert'); }
  finally { busy = false; draw(); message.focus(); }
}

form.addEventListener('submit', (event) => { event.preventDefault(); submit(true); });
cancelButton.addEventListener('click', () => submit(false));
selectAll.addEventListener('change', () => { for (const entry of entries.values()) if (entry.status === 'pending' && tokens.has(entry.change_id)) entry.selected = selectAll.checked; draw(); });
refreshButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true; controls();
  try { render(await callTool('review_pending_changes', {})); }
  catch (error) { message.textContent = error.message; message.setAttribute('role', 'alert'); }
  finally { busy = false; draw(); message.focus(); }
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.id === 1 && data.result) {
    initialized = true;
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*'); controls(); resize();
  } else if (requests.has(data.id)) {
    const request = requests.get(data.id); requests.delete(data.id); clearTimeout(request.timeout);
    if (data.error) request.reject(new Error(data.error.message ?? 'The review request failed.'));
    else request.resolve(data.result);
  } else if (data.method === 'ui/notifications/tool-result' && !busy) render(data.params);
  else if (data.method === 'ui/notifications/tool-cancelled' && !busy) { message.textContent = 'Review cancelled.'; resize(); }
  else if (data.type === 'openai:set_globals' && !busy) render(data.globals?.toolOutput ?? data.toolOutput);
});
function globals() { if (!busy && window.openai?.toolOutput) render(window.openai.toolOutput); }
window.addEventListener('openai:set_globals', globals); document.addEventListener('openai:set_globals', globals);
window.addEventListener('resize', resize);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body?.classList.contains('review-native')) {
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/close' }, '*');
  }
});
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(document.querySelector('.review-panel'));
globals();
setTimeout(() => { if (!received) { message.textContent = 'The review form did not receive pending changes. Ask ChatGPT to open the review again.'; resize(); } }, 10000);
window.parent.postMessage({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {
  appInfo: { name: 'EquipMap change review', version: '1.0.0' }, appCapabilities: {}, protocolVersion: '2026-01-26',
} }, '*');
