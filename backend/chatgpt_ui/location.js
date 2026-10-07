const status = document.getElementById('location-status');
const locations = document.getElementById('location-results');
const template = document.getElementById('location-template');
let initialized = false;
let rendered = false;

function notify(method, params = {}) {
  window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
}

function resize() {
  if (initialized) notify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
}

function render(result) {
  if (!result) return;
  const hostMetadata = result?.metadata ?? window.openai?.toolResponseMetadata ?? {};
  // ChatGPT preserves the complete MCP envelope inside its widget-only metadata.
  const envelope = result?.structuredContent ? result
    : hostMetadata.mcp_tool_result ?? hostMetadata.call_tool_result ?? result;
  const data = envelope?.structuredContent ?? result?.toolOutput ?? result;
  if (!data || typeof data !== 'object') return;
  const metadata = envelope?._meta ?? result?._meta ?? hostMetadata;
  const imageBlocks = Array.isArray(envelope?.content) ? envelope.content.filter(item => item?.type === 'image') : [];

  locations.replaceChildren();
  status.hidden = false;

  if (data.error) {
    status.textContent = data.error;
    rendered = true;
    resize();
    return;
  }

  let entries = null;
  if (data.record) {
    entries = [data];
  } else if (Array.isArray(data.results)) {
    entries = data.results;
  } else if (Array.isArray(data)) {
    entries = data;
  } else if (data.id && (data.name || data.x_coordinate !== undefined)) {
    entries = [{ record: data, image_status: 'included' }];
  }

  if (!entries || !Array.isArray(entries)) {
    return;
  }

  rendered = true;
  status.textContent = 'No matching locations.';
  status.hidden = entries.length > 0;

  for (const entry of entries) {
    const record = entry.record ?? entry;
    const fragment = template.content.cloneNode(true);
    const heading = fragment.querySelector('.location-title');
    const context = fragment.querySelector('.location-context');
    const message = fragment.querySelector('.location-message');
    const image = fragment.querySelector('.location-image');
    const caption = fragment.querySelector('.location-caption');
    const link = fragment.querySelector('.location-link');

    heading.textContent = record.name ?? `${entry.type || 'Location'} #${entry.id || ''}`;
    context.textContent = [record.site_name, record.floorplan_name].filter(Boolean).join(' · ');

    const imgIndex = entry.presentation?.image_index;
    let png = null;
    if (data.record) {
      png = metadata.imagePng ?? imageBlocks[0]?.data;
    } else if (entry.image_status === 'included' && entry.presentation?.image_ready === true
      && Number.isInteger(imgIndex) && imgIndex >= 0) {
      png = metadata.images?.find((item) => item.image_index === imgIndex)?.imagePng
        ?? imageBlocks[imgIndex]?.data;
    }
    if (data.record && !png && typeof metadata.imagePng === 'string') {
      png = metadata.imagePng;
    }

    if (typeof png === 'string' && /^[A-Za-z0-9+/=]+$/.test(png.trim())) {
      image.alt = `Saved location of ${record.name || 'item'} on ${record.floorplan_name || 'drawing'}`;
      image.addEventListener('load', resize);
      image.addEventListener('error', () => {
        image.hidden = caption.hidden = true;
        message.hidden = false;
        message.textContent = 'The preview is unavailable. Open the saved location in EquipMap.';
        resize();
      });
      image.src = `data:image/png;base64,${png.trim()}`;
      image.hidden = caption.hidden = false;
      message.hidden = true;
    } else {
      message.textContent = entry.image_error ?? (entry.image_status === 'skipped'
        ? (entry.image_skip_reason === 'limit' ? 'Image limit reached for this call.' : 'No image requested for this search result.')
        : 'The preview is unavailable. Open the saved location in EquipMap.');
    }

    try {
      if (record.url) {
        const url = new URL(record.url);
        if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
          link.href = url.href;
          link.hidden = false;
        }
      }
    } catch { link.hidden = true; }

    locations.append(fragment);
  }
  resize();
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.id === 1 && message.result) {
    initialized = true;
    notify('ui/notifications/initialized');
    resize();
  }
  if (message.method === 'ui/notifications/tool-result') {
    render(message.params);
  } else if (message.method === 'ui/notifications/tool-cancelled') {
    locations.replaceChildren();
    status.hidden = false;
    status.textContent = 'Location preview was cancelled.';
    resize();
  } else if (message.type === 'openai:set_globals') {
    render(message.globals?.toolOutput ?? message.toolOutput);
  } else if (message.toolOutput) {
    render(message.toolOutput);
  } else if (message.structuredContent) {
    render(message);
  }
});

function tryRenderGlobals() {
  if (window.openai?.toolOutput) {
    render(window.openai.toolOutput);
  }
}

window.addEventListener('openai:set_globals', tryRenderGlobals);
document.addEventListener('openai:set_globals', tryRenderGlobals);

tryRenderGlobals();

let pollCount = 0;
const pollInterval = setInterval(() => {
  pollCount++;
  if (rendered) {
    clearInterval(pollInterval);
  } else if (window.openai?.toolOutput) {
    tryRenderGlobals();
  } else if (pollCount >= 50) {
    clearInterval(pollInterval);
    if (!rendered && !locations.hasChildNodes()) {
      status.textContent = 'The preview is unavailable. Open EquipMap to view the saved location.';
      resize();
    }
  }
}, 100);

window.parent.postMessage({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {
  appInfo: { name: 'EquipMap location', version: '1.1.0' },
  appCapabilities: {}, protocolVersion: '2026-01-26',
} }, '*');
