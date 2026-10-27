'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const isImageModel = model => /(?:^|[\/_-])(?:gpt-image|dall-e|imagen|flux)(?:$|[\/_-])/i.test(model || '');
function pngInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Image API không trả ảnh PNG hợp lệ (tối đa 20 MB).');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) throw new Error('Kích thước ảnh PNG không hợp lệ.');
  return { width, height };
}
async function stageImage(directory, run, image) {
  const info = pngInfo(image.bytes);
  const folder = path.join(directory, run + '.assets');
  await fs.mkdir(folder, { recursive: true });
  const artifact = crypto.randomBytes(16).toString('hex') + '.png';
  await fs.writeFile(path.join(folder, artifact), image.bytes, { flag: 'wx' });
  return { artifact, ...info, bytes: image.bytes.length };
}
async function imageArtifact(directory, run, artifact) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(run || '') || !/^[a-f0-9]{32}\.png$/.test(artifact || '')) throw new Error('Ảnh không thuộc session hợp lệ.');
  const base = await fs.realpath(directory);
  const target = await fs.realpath(path.join(directory, run + '.assets', artifact));
  if (!target.startsWith(base + path.sep)) throw new Error('Đường dẫn ảnh vượt khỏi thư mục session.');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size < 33 || stat.size > 20 * 1024 * 1024) throw new Error('File ảnh không hợp lệ.');
  const handle = await fs.open(target, 'r');
  try { const head = Buffer.alloc(33); await handle.read(head, 0, 33, 0); pngInfo(head); }
  finally { await handle.close(); }
  return target;
}
// Every image is produced by this dedicated proxy model when available, never by the text model of a position.
const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
function pickImageModel(models = [], fallback) {
  const ids = models.map(model => model.id || model);
  if (ids.includes(DEFAULT_IMAGE_MODEL)) return DEFAULT_IMAGE_MODEL;
  if (fallback && isImageModel(fallback) && ids.includes(fallback)) return fallback;
  return ids.find(isImageModel);
}
module.exports = { DEFAULT_IMAGE_MODEL, pickImageModel, isImageModel, pngInfo, stageImage, imageArtifact };
