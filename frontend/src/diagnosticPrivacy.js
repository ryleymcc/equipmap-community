const secretKey = /authorization|cookie|password|passwd|token|secret|api[-_]?key|email|ip_address/i;

export function redactText(value) {
  // Axios errors and console arguments often contain JSON serialized inside JSON.
  const jsonStart = value.search(/[[{]/);
  if (jsonStart >= 0) {
    try {
      return value.slice(0, jsonStart) + JSON.stringify(sanitizeDiagnostics(JSON.parse(value.slice(jsonStart))));
    } catch { /* plain text */ }
  }
  return value
    .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/https?:\/\/[^\s"<>]+/g, url => url.split(/[?#]/)[0])
    .replace(/(["']?(?:[\w-]*(?:token|password|secret|api_key))["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi, '$1[REDACTED]');
}

export function sanitizeDiagnostics(value, depth = 0) {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeDiagnostics(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, key === 'user' ? {} : secretKey.test(key) ? '[REDACTED]' : sanitizeDiagnostics(item, depth + 1),
  ]));
}
