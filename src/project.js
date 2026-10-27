'use strict';
const path = require('path');
const crypto = require('crypto');
function projectKey(roots, workspaceFile, emptyId = 'no-folder') {
  const normalize = value => { const resolved = path.resolve(value).replace(/\\/g, '/'); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };
  const identity = workspaceFile ? 'workspace:' + normalize(workspaceFile) : roots.length ? 'folders:' + roots.map(normalize).sort().join('\n') : 'empty:' + emptyId;
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}
function projectDirectory(base, roots, workspaceFile, emptyId) { return path.join(base, 'projects', projectKey(roots, workspaceFile, emptyId)); }
module.exports = { projectKey, projectDirectory };
