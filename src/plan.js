'use strict';
const { safeRelative } = require('./workspace');
const ID = /^[a-z][a-z0-9_-]{0,39}$/;
const validId = value => typeof value === 'string' && ID.test(value) && !['__proto__', 'constructor', 'prototype', 'lead'].includes(value);
function text(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(label + ' không hợp lệ.');
  return value.trim();
}
function validatePlan(input, models) {
  const available = new Set(models.map(model => typeof model === 'string' ? model : model.id));
  if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length > 8) throw new Error('Plan cần từ 1 đến 8 vị trí.');
  if (!Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length > 60) throw new Error('Plan cần từ 1 đến 60 việc.');
  const roleIds = new Set(), taskIds = new Set();
  const roles = input.roles.map(role => {
    if (!validId(role.id) || roleIds.has(role.id)) throw new Error('ID vị trí không hợp lệ hoặc trùng.');
    roleIds.add(role.id);
    if (!available.has(role.model)) throw new Error('Model cho ' + role.id + ' không có trong danh sách proxy.');
    return { id: role.id, name: text(role.name, 'Tên vị trí', 100), responsibility: text(role.responsibility, 'Trách nhiệm'), model: role.model, ...(role.kind === 'tech' ? { kind: 'tech' } : {}), reason: typeof role.reason === 'string' ? role.reason.slice(0, 1000) : '' };
  });
  const tasks = input.tasks.map(task => {
    if (!validId(task.id) || taskIds.has(task.id)) throw new Error('ID việc không hợp lệ hoặc trùng.');
    taskIds.add(task.id);
    if (!roleIds.has(task.roleId)) throw new Error('Việc chưa được giao cho vị trí hợp lệ.');
    if (!Array.isArray(task.scope) || task.scope.length > 20) throw new Error('Phạm vi việc không hợp lệ.');
    const scope = [...new Set(task.scope.map(item => { const safe = safeRelative(item); if (!safe || safe === '.') throw new Error('Hãy chỉ rõ file hoặc thư mục trong phạm vi.'); return safe; }))];
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some(id => typeof id !== 'string')) throw new Error('Danh sách phụ thuộc không hợp lệ.');
    const acceptance = (task.acceptance || []);
    if (!Array.isArray(acceptance) || acceptance.length > 12) throw new Error('Checklist tối đa 12 tiêu chí.');
    const criteria = new Set();
    const checked = acceptance.map(item => {
      if (!validId(item.id) || criteria.has(item.id) || !['analysis', 'file', 'image', 'tool'].includes(item.verification)) throw new Error('Tiêu chí nghiệm thu không hợp lệ hoặc trùng ID.');
      const tool = item.verification === 'tool' ? text(item.tool, 'Tên tool nghiệm thu', 160) : undefined;
      const expected = item.verification === 'tool' ? text(item.expected, 'Kết quả tool mong đợi', 1000) : undefined;
      criteria.add(item.id); return { id: item.id, description: text(item.description, 'Tiêu chí', 2000), verification: item.verification, ...(tool ? { tool, expected } : {}) };
    });
    if (task.estimateMinutes != null && (!Number.isFinite(task.estimateMinutes) || task.estimateMinutes < 1 || task.estimateMinutes > 180)) throw new Error('Ước tính task phải từ 1 đến 180 phút.');
    return { id: task.id, roleId: task.roleId, title: text(task.title, 'Tên việc', 240), instruction: text(task.instruction, 'Nội dung việc', 8000), scope, dependsOn: [...new Set(task.dependsOn)], ...(task.estimateMinutes ? { estimateMinutes: task.estimateMinutes } : {}), ...(task.kind === 'tech' ? { kind: 'tech' } : {}), ...(checked.length ? { acceptance: checked } : {}) };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error('Phụ thuộc vào việc không tồn tại: ' + id);
    if (visiting.has(id)) throw new Error('Plan có vòng phụ thuộc.');
    if (visited.has(id)) return;
    visiting.add(id); byId.get(id).dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  tasks.forEach(task => visit(task.id));
  const used = new Set(tasks.map(task => task.roleId));
  if (roles.some(role => !used.has(role.id))) throw new Error('Mỗi vị trí cần có ít nhất một việc.');
  return { summary: text(input.summary, 'Phân tích project', 8000), roles, tasks };
}
function inScope(file, scope) { return scope.some(base => file.toLowerCase() === base.toLowerCase() || file.toLowerCase().startsWith(base.toLowerCase() + '/')); }
function overlaps(a, b) { return a.scope.some(left => b.scope.some(right => inScope(left, [right]) || inScope(right, [left]))); }
module.exports = { validatePlan, inScope, overlaps };
