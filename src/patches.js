'use strict';
const { safeRelative, workspaceTool } = require('./workspace');
const { inScope } = require('./plan');
async function expandPatches(root, task, result, dependencies) {
  const patches = result.filePatches || [];
  if (!Array.isArray(patches) || patches.length > 12) throw new Error('Tối đa 12 file bản vá trong một task.');
  const files = [...(result.files || [])], seen = new Set(files.map(file => safeRelative(file.path).toLowerCase()));
  for (const patch of patches) {
    const relative = safeRelative(patch.path);
    if (!root || !inScope(relative, task.scope) || seen.has(relative.toLowerCase()) || !Array.isArray(patch.edits) || !patch.edits.length || patch.edits.length > 20) throw new Error('Bản vá trùng file hoặc ngoài scope.');
    seen.add(relative.toLowerCase());
    const proposed = Object.values(dependencies).flatMap(result => result.files || []).filter(file => file.path.toLowerCase() === relative.toLowerCase()).at(-1);
    let content = proposed?.content ?? await workspaceTool(root, 'read_patch_base', { path: relative });
    for (const edit of patch.edits) {
      if (typeof edit.oldText !== 'string' || !edit.oldText.length || typeof edit.newText !== 'string' || edit.oldText.length + edit.newText.length > 80000) throw new Error('Bản vá cần oldText/newText ngắn, chính xác.');
      const index = content.indexOf(edit.oldText);
      if (index < 0 || content.indexOf(edit.oldText, index + 1) >= 0) throw new Error('Đoạn gốc của bản vá thiếu hoặc xuất hiện nhiều lần: ' + relative);
      content = content.slice(0, index) + edit.newText + content.slice(index + edit.oldText.length);
    }
    files.push({ path: relative, content });
  }
  return { ...result, files };
}
module.exports = { expandPatches };
