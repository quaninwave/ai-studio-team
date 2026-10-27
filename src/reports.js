'use strict';
const crypto = require('node:crypto');
const { isImageModel } = require('./images');

function contract(task) {
  if (task.acceptance?.length) return task;
  return { ...task, acceptance: [{ id: 'deliverable', description: task.instruction, verification: 'analysis' }] };
}
function cleanChecks(checks) {
  return (Array.isArray(checks) ? checks : []).slice(0, 12).filter(check => check && typeof check.id === 'string').map(check => ({
    id: check.id.slice(0, 40), status: ['pass', 'fail', 'blocked'].includes(check.status) ? check.status : 'blocked',
    evidence: (Array.isArray(check.evidence) ? check.evidence : []).slice(0, 8).filter(item => item && typeof item.detail === 'string').map(item => ({ type: String(item.type || '').slice(0, 20), detail: item.detail.slice(0, 2000), ...(typeof item.path === 'string' ? { path: item.path.slice(0, 500) } : {}), ...(typeof item.callId === 'string' ? { callId: item.callId.slice(0, 100) } : {}) }))
  }));
}
function managedPlan(plan, models, coordinator, legacy = false) {
  const roles = [...plan.roles], tasks = plan.tasks.map(task => legacy ? task : contract(!task.acceptance?.length && isImageModel(plan.roles.find(role => role.id === task.roleId)?.model) ? { ...task, acceptance: [{ id: 'image_asset', description: 'Tạo PNG thật theo brief được giao; báo đúng kích thước thực tế và phần chưa kiểm chứng.', verification: 'image' }] } : task));
  let tech = roles.find(role => role.kind === 'tech');
  if (!tech) {
    if (roles.length >= 8 || tasks.length >= 24) throw new Error('Chừa 1 vị trí và 1 task cho Tech (tối đa 7 vị trí nghiệp vụ / 23 task).');
    let id = 'tech'; while (roles.some(role => role.id === id)) id += '_sys';
    const ids = models.map(model => model.id || model);
    const model = ids.find(id => id === 'gpt-6.1-sol') || ids.find(id => /gpt-6(?:\.1)?-sol/.test(id)) || roles.find(role => !isImageModel(role.model))?.model || coordinator;
    tech = { id, name: 'Tech · Hệ thống', kind: 'tech', responsibility: 'Chẩn đoán lỗi endpoint, mạng, tool, runtime và task thất bại; đề xuất xử lý đúng nguyên nhân, báo blocker và bằng chứng. Không báo đã sửa nếu chưa thực thi/kiểm chứng.', model, reason: 'Chuyên trách độ ổn định và lỗi hệ thống.' };
    roles.push(tech);
  }
  if (!tasks.some(task => task.roleId === tech.id && task.kind === 'tech')) {
    let id = 'system_diagnosis'; while (tasks.some(task => task.id === id)) id += '_sys';
    tasks.push(contract({ id, kind: 'tech', roleId: tech.id, title: 'Chẩn đoán hệ thống & báo cáo độ ổn định', instruction: 'Đọc diagnostics và log của lượt chạy. Phân loại lỗi gốc: mạng/auth/endpoint/model/tool/runtime. Đưa cách khắc phục cụ thể, task cần làm lại, model/endpoint đề xuất và blocker. Nếu một model (kể cả PO) lỗi lặp lại, đề xuất PO đổi sang model khác có trong catalog, ưu tiên cùng mức giá; PO quyết định qua modelRecommendations. Nếu không có lỗi, báo phạm vi kiểm chứng; không tự nhận đã chạy test. Trả báo cáo ngắn theo checklist.', scope: [], dependsOn: [] }));
  }
  return { ...plan, roles, tasks };
}
function assessment(task, result, toolHistory = []) {
  if (!task.acceptance?.length) return { passed: true, legacy: true, checks: [] };
  const checks = task.acceptance.map(criterion => {
    const reports = (Array.isArray(result.checks) ? result.checks : []).filter(check => check.id === criterion.id);
    const reported = reports.length === 1 ? reports[0] : {};
    const evidence = (Array.isArray(reported.evidence) ? reported.evidence : []).slice(0, 8).filter(item => item && typeof item.detail === 'string' && item.detail.trim().length >= 12);
    let supported = false;
    if (criterion.verification === 'file') supported = evidence.some(item => item.type === 'file' && result.files?.some(file => file.path === item.path && file.content?.length));
    else if (criterion.verification === 'image') supported = evidence.some(item => item.type === 'image' && result.images?.some(image => image.path === item.path && image.artifact));
    else if (criterion.verification === 'tool') supported = !!criterion.tool && !!criterion.expected && evidence.some(item => item.type === 'tool' && toolHistory.some(call => call.id === item.callId && call.status === 'complete' && !call.isError && (call.tool === criterion.tool || call.server + '/' + call.tool === criterion.tool) && call.result?.includes(criterion.expected)));
    else supported = evidence.some(item => item.type === 'analysis');
    return { id: criterion.id, description: criterion.description, verification: criterion.verification, status: reported.status === 'pass' && supported ? 'pass' : reported.status === 'fail' ? 'fail' : 'blocked', evidence, note: supported ? 'Có bằng chứng kèm báo cáo; PO vẫn cần đánh giá tính đúng.' : 'Thiếu bằng chứng hợp lệ hoặc chưa thực hiện kiểm chứng.' };
  });
  return { passed: checks.every(check => check.status === 'pass'), checks };
}
function compactResults(results) {
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
    summary: result.summary?.slice(0, 6000), error: result.error, diagnostic: result.diagnostic, modelRecommendations: result.modelRecommendations, assessment: result.assessment, checks: result.checks,
    files: (result.files || []).map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content || ''), sha256: crypto.createHash('sha256').update(file.content || '').digest('hex') })),
    images: (result.images || []).map(({ path, artifact, width, height, model }) => ({ path, artifact, width, height, model }))
  }]));
}
module.exports = { managedPlan, contract, assessment, compactResults, cleanChecks };
