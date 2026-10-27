'use strict';
const { safeRelative } = require('./workspace');
function deliveryReport(data) {
  const results = data.results || {}, status = data.status || {}, tasks = data.plan?.tasks || [];
  const tools = (data.toolHistory || []).filter(call => call.status === 'complete' && !call.isError);
  const files = [], images = [], verified = [], incomplete = [];
  for (const task of tasks) {
    const result = results[task.id];
    for (const file of result?.files || []) { try { files.push({ path: safeRelative(file.path), taskId: task.id, state: data.appliedPaths?.includes(file.path) ? 'applied' : 'proposed' }); } catch {} }
    for (const image of result?.images || []) images.push({ path: image.path, taskId: task.id, artifact: image.artifact, state: 'staged' });
    for (const check of result?.assessment?.checks || []) {
      const evidence = (check.evidence || []).filter(item => item.type === 'tool' && tools.some(tool => tool.id === item.callId));
      if (check.status === 'pass' && evidence.length) verified.push({ taskId: task.id, description: check.description, evidence });
      if (check.status !== 'pass') incomplete.push({ taskId: task.id, title: task.title, detail: check.description + ' · ' + check.status });
    }
    if (status[task.id] !== 'done' || result?.error) incomplete.push({ taskId: task.id, title: task.title, detail: result?.error || status[task.id] || 'Chưa thực hiện' });
  }
  return { approved: data.approved === true, summary: data.summary || '', files, images, verified, incomplete, cleanedTestFiles: data.cleanedTestFiles || [], toolCalls: tools.length, nextAction: incomplete.length || !data.approved ? 'Xem phần chưa đạt, trao đổi với PO và tiếp tục trong session này.' : files.some(file => file.state === 'proposed') ? 'Xem diff và áp dụng các file đề xuất. Ảnh cần lưu/import riêng.' : 'Xem kết quả và các bằng chứng đã xác minh.' };
}
function deliveryMarkdown(delivery) {
  return '\n\n## Bàn giao\n\n' + delivery.summary + '\n\n' + (delivery.files.map(file => '- ' + file.path + ' · ' + (file.state === 'applied' ? 'đã áp dụng' : 'đề xuất, chưa áp dụng')).join('\n') || 'Chưa có file code đề xuất.') + '\n' + delivery.images.map(image => '- ' + image.path + ' · PNG đã tạo, chưa xác minh import Unity').join('\n') + (delivery.cleanedTestFiles?.length ? '\n\n### Test tạm đã dọn\n\n' + delivery.cleanedTestFiles.map(file => '- ' + file).join('\n') : '') + '\n\n### Xác minh bằng công cụ\n\n' + (delivery.verified.map(check => '- ' + check.description + ': ' + check.evidence.map(item => item.callId + ' · ' + item.detail).join('; ')).join('\n') || 'Chưa có tiêu chí được xác minh bằng kết quả công cụ. Báo cáo phân tích không được tính là test đã chạy.') + '\n\n### Chưa hoàn tất\n\n' + (delivery.incomplete.map(item => '- ' + item.title + ': ' + item.detail).join('\n') || 'Không có task hoặc tiêu chí được ghi nhận thiếu.') + '\n\n' + delivery.nextAction;
}
module.exports = { deliveryReport, deliveryMarkdown };
