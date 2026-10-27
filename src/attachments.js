'use strict';
// CEO chat attachments: pasted/uploaded images are stored in the session folder and sent to the PO
// as vision input; files/folders are summarized (path + tree) so the team can inspect them.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGES = 6, MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_PATHS = 10;
const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const SKIP = new Set(['node_modules', '.git', 'Library', 'Temp', 'Obj', 'obj', 'Logs', 'UserSettings', '.vs', '.idea']);

async function tree(root, depth = 3, limit = 250) {
  const lines = [];
  const walk = async (dir, level, prefix) => {
    if (level > depth || lines.length >= limit) return;
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= limit) { lines.push(prefix + '…'); return; }
      if (SKIP.has(entry.name) || entry.name.endsWith('.meta') || entry.isSymbolicLink()) continue;
      lines.push(prefix + (entry.isDirectory() ? entry.name + '/' : entry.name));
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), level + 1, prefix + '  ');
    }
  };
  await walk(root, 1, '');
  return lines.join('\n');
}

// images: [{ name, dataUrl }]; paths: absolute paths picked by the user in VS Code.
async function saveAttachments(directory, run, { images = [], paths = [] } = {}, roots = []) {
  if (!Array.isArray(images) || !Array.isArray(paths) || images.length > MAX_IMAGES || paths.length > MAX_PATHS) throw new Error('Tối đa ' + MAX_IMAGES + ' ảnh và ' + MAX_PATHS + ' file/thư mục mỗi tin.');
  const out = [];
  if (images.length) await fs.mkdir(path.join(directory, run + '.attachments'), { recursive: true });
  for (const image of images) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(String(image?.dataUrl || ''));
    if (!match) throw new Error('Ảnh đính kèm phải là PNG, JPG, WEBP hoặc GIF.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Mỗi ảnh tối đa 8 MB.');
    const file = crypto.randomBytes(16).toString('hex') + '.' + MIME[match[1]];
    await fs.writeFile(path.join(directory, run + '.attachments', file), bytes, { flag: 'wx' });
    out.push({ type: 'image', name: String(image.name || 'ảnh dán').slice(0, 120), file, mime: match[1], bytes: bytes.length });
  }
  for (const raw of paths) {
    const absolute = path.resolve(String(raw || ''));
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) throw new Error('Không tìm thấy: ' + absolute);
    const root = roots.find(item => absolute === item || absolute.startsWith(item + path.sep));
    const relative = root ? path.relative(root, absolute).replace(/\\/g, '/') || '.' : undefined;
    if (stat.isDirectory()) out.push({ type: 'folder', name: path.basename(absolute), path: absolute, relative, listing: await tree(absolute) });
    else out.push({ type: 'file', name: path.basename(absolute), path: absolute, relative, bytes: stat.size });
  }
  return out;
}

async function imageParts(directory, run, attachments = []) {
  const parts = [];
  for (const item of attachments.filter(item => item.type === 'image')) {
    if (!/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(item.file || '')) continue;
    try { parts.push({ type: 'image_url', image_url: { url: 'data:' + item.mime + ';base64,' + (await fs.readFile(path.join(directory, run + '.attachments', item.file))).toString('base64') } }); } catch {}
  }
  return parts;
}

function describe(attachments = []) {
  if (!attachments.length) return '';
  return '\n\n[CEO attachments]\n' + attachments.map(item => item.type === 'image' ? '- Image "' + item.name + '" (attached below; view it)'
    : item.type === 'folder' ? '- Folder ' + (item.relative ? 'in project: ' + item.relative : 'outside project: ' + item.path) + '\n' + item.listing.split('\n').slice(0, 120).map(line => '    ' + line).join('\n')
    : '- File ' + (item.relative ? 'in project: ' + item.relative : 'outside project: ' + item.path) + ' (' + item.bytes + ' bytes)').join('\n')
    + '\nProject-relative paths can be read with workspace tools. For outside paths, tell workers what to import (download_file/write_file into the project) rather than asking the CEO again.';
}

module.exports = { saveAttachments, imageParts, describe, tree };
