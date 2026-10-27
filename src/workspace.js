'use strict';
const fs = require('fs/promises');
const path = require('path');
const SKIP = new Set(['node_modules', '.git', '.env', '.codex', '.claude', 'dist', 'build', '.next', 'vendor']);
function safeRelative(value) {
  if (typeof value !== 'string' || path.isAbsolute(value) || /^[a-z]:/i.test(value) || value.includes('\u0000')) throw new Error('Chỉ chấp nhận đường dẫn tương đối.');
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part.includes(':') || SKIP.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part) || /^(?:auth|credentials|secrets)(?:\.|$)/i.test(part) || /\.(?:pem|key|pfx|p12)$/i.test(part))) throw new Error('Không đọc file bí mật hoặc đường dẫn ngoài workspace.');
  return parts.filter(part => part !== '.').join('/');
}
async function workspaceTool(root, name, args) {
  const relative = safeRelative(args.path || '');
  const actual = await fs.realpath(path.resolve(root, relative));
  const realRoot = await fs.realpath(root);
  if (actual !== realRoot && !actual.startsWith(realRoot + path.sep)) throw new Error('Đường dẫn vượt khỏi workspace.');
  safeRelative(path.relative(realRoot, actual));
  if (name === 'read_excerpt') {
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size > 4000000) throw new Error('Đoạn trích chỉ hỗ trợ file văn bản tối đa 4 MB.');
    const data = await fs.readFile(actual); if (data.includes(0)) throw new Error('Không đọc file nhị phân.');
    const lines = data.toString('utf8').split('\n');
    const query = typeof args.query === 'string' ? args.query.slice(0, 300) : '';
    const count = Math.min(120, Math.max(1, Number.isInteger(args.count) ? args.count : 80));
    const match = query ? lines.findIndex((line, index) => index >= Math.max(0, (args.startLine || 1) - 1) && line.includes(query)) : -1;
    if (query && match < 0) return 'No matching line. Total lines: ' + lines.length;
    const start = query ? Math.max(0, match - 8) : Math.max(0, (Number.isInteger(args.startLine) ? args.startLine : 1) - 1);
    return JSON.stringify({ totalLines: lines.length, startLine: start + 1, note: 'Partial source; not the full file.', lines: lines.slice(start, start + count).map((line, index) => (start + index + 1) + ': ' + line).join('\n').slice(0, 32000) });
  }
  if (name === 'read_file' || name === 'read_patch_base') {
    const stat = await fs.stat(actual);
    const maximum = name === 'read_patch_base' ? 300000 : 160000;
    if (!stat.isFile() || stat.size > maximum) throw new Error('Chỉ đọc file văn bản tối đa ' + maximum / 1000 + ' KB.');
    const data = await fs.readFile(actual);
    if (data.includes(0)) throw new Error('Không đọc file nhị phân.');
    return data.toString('utf8');
  }
  if (name === 'list_files') {
    const entries = await fs.readdir(actual, { withFileTypes: true });
    return entries.filter(entry => { try { safeRelative(entry.name); return !entry.isSymbolicLink(); } catch { return false; } }).slice(0, 160).map(entry => (entry.isDirectory() ? 'dir  ' : 'file ') + entry.name).join('\n');
  }
  throw new Error('Tool không được hỗ trợ.');
}
module.exports = { safeRelative, workspaceTool };
