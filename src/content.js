'use strict';

// Keep prompt prefixes stable and shrink only repeated/diagnostic content.
// Source files are never rewritten by this helper; it is used only for model context.
function compactText(value, max = 12000) {
  let text = String(value ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  const marker = '\n… [đã nén/bỏ qua phần giữa] …\n';
  if (max <= marker.length + 2) return text.slice(0, max);
  const head = Math.max(1, Math.floor((max - marker.length) * 0.72));
  const tail = Math.max(1, max - marker.length - head);
  return text.slice(0, head) + marker + text.slice(-tail);
}

function compactValue(value, options = {}, depth = 0) {
  const maxString = options.maxString || 4000, maxArray = options.maxArray || 30, maxDepth = options.maxDepth ?? 5;
  if (typeof value === 'string') return compactText(value, maxString);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= maxDepth) return '[đã nén]';
  if (Array.isArray(value)) return value.slice(-maxArray).map(item => compactValue(item, options, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = compactValue(item, options, depth + 1);
    return out;
  }
  return String(value);
}

function compactJson(value, options = {}) { return JSON.stringify(compactValue(value, options)); }

module.exports = { compactText, compactValue, compactJson };
