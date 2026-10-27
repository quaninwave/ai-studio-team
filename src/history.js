'use strict';
const crypto = require('crypto');

// Rework snapshots keep full file bodies only for the most recent rounds; older ones keep path, size and hash.
const KEEP_FULL = 2, MAX_ENTRIES = 20;
function slimResults(results) {
  const out = {};
  for (const [id, result] of Object.entries(results || {})) {
    out[id] = { ...result, files: (result?.files || []).map(file => file.content === undefined ? file : { path: file.path, bytes: Buffer.byteLength(String(file.content)), sha256: crypto.createHash('sha256').update(String(file.content)).digest('hex') }) };
  }
  return out;
}
function pushHistory(history, entry) {
  const list = [...(history || []), entry].slice(-MAX_ENTRIES);
  const full = list.map((item, index) => index >= list.length - KEEP_FULL || !item?.results ? item : { ...item, results: slimResults(item.results), slim: true });
  return full;
}
module.exports = { pushHistory, slimResults };
