'use strict';
const { overlaps } = require('./plan');
const { isImageModel } = require('./images');
const MINUTE = 60000;
const RULES = [
  'Bám hướng CEO đã duyệt; không tự mở rộng phạm vi hoặc đổi gameplay cũ.',
  'Đọc đúng nguồn/API trước khi sửa. Chỉ sở hữu file trong scope; phối hợp qua phụ thuộc.',
  'Mỗi task là một phần việc nhỏ có bằng chứng nghiệm thu; ưu tiên bản vá ngắn cho file lớn.',
  'Không báo đã áp dụng, import, compile hay test nếu chưa có kết quả công cụ xác nhận.',
  'Đến gần deadline: chốt phần nhỏ, báo phần còn thiếu và nguyên nhân trễ cho PO; không bịa kết quả.',
  'Lỗi kỹ thuật gửi Tech/PO; không đẩy xử lý endpoint, retry hoặc API cho CEO.',
  'Không ghi đè file ngoài scope, không đọc bí mật, không bỏ qua lỗi để tự tick pass.'
];
function taskMinutes(task, plan) {
  if (Number.isFinite(task.estimateMinutes) && task.estimateMinutes >= 1 && task.estimateMinutes <= 180) return task.estimateMinutes;
  const role = plan.roles.find(role => role.id === task.roleId);
  return task.kind === 'tech' ? 3 : isImageModel(role?.model) ? 6 : task.scope.length ? 5 : 3;
}
function forecast(plan, status = {}, now = Date.now()) {
  const pending = new Map(plan.tasks.filter(task => status[task.id] !== 'done').map(task => [task.id, task]));
  const finished = new Map(plan.tasks.filter(task => status[task.id] === 'done').map(task => [task.id, 0]));
  const active = [], entries = {}; let cursor = 0;
  while (pending.size || active.length) {
    for (let index = active.length - 1; index >= 0; index--) if (active[index].end <= cursor) { finished.set(active[index].task.id, cursor); active.splice(index, 1); }
    for (const [id, task] of pending) {
      if (active.length >= 3) break;
      if (task.kind === 'tech' && ([...pending.values()].some(other => other.kind !== 'tech') || active.some(other => other.task.kind !== 'tech'))) continue;
      if (!task.dependsOn.every(id => finished.has(id)) || active.some(other => other.task.roleId === task.roleId || overlaps(other.task, task))) continue;
      const minutes = taskMinutes(task, plan), end = cursor + minutes * MINUTE;
      active.push({ task, end }); pending.delete(id);
      entries[id] = { estimateMinutes: minutes, plannedStartAt: new Date(now + cursor).toISOString(), deadlineAt: new Date(now + end).toISOString() };
    }
    if (active.length) cursor = Math.min(...active.map(item => item.end));
    else if (pending.size) throw new Error('Không lập được lịch do phụ thuộc không hợp lệ.');
  }
  const productionMinutes = Math.ceil(cursor / MINUTE);
  const reviewMinutes = 3, contingencyMinutes = productionMinutes ? Math.max(1, Math.ceil(productionMinutes * .2)) : 0;
  const estimatedMinutes = productionMinutes + reviewMinutes + contingencyMinutes;
  const roles = Object.fromEntries(plan.roles.map(role => {
    const tasks = plan.tasks.filter(task => task.roleId === role.id && entries[task.id]);
    return [role.id, { estimateMinutes: tasks.reduce((sum, task) => sum + entries[task.id].estimateMinutes, 0), deadlineAt: tasks.length ? new Date(Math.max(...tasks.map(task => Date.parse(entries[task.id].deadlineAt)))).toISOString() : null }];
  }));
  return { estimatedMinutes, productionMinutes, reviewMinutes, contingencyMinutes, projectedFinishAt: new Date(now + estimatedMinutes * MINUTE).toISOString(), tasks: entries, roles };
}
function beginSchedule(runner, now = Date.now()) {
  observeSchedule(runner, now);
  const old = runner.schedule || {}, estimate = forecast(runner.plan, Object.fromEntries(runner.taskStatus), now);
  runner.schedule = { ...old, ...estimate, activeSince: now, provisional: false, startedAt: old.startedAt || new Date(now).toISOString(), cycleStartedAt: new Date(now).toISOString(), cycle: (old.cycle || 0) + 1, originalFinishAt: old.startedAt && old.originalFinishAt || estimate.projectedFinishAt, tasks: { ...old.tasks, ...estimate.tasks }, rules: RULES };
  return runner.schedule;
}
function updateForecast(runner, now = Date.now()) {
  if (!runner.schedule) return;
  const estimate = forecast(runner.plan, Object.fromEntries(runner.taskStatus), now);
  for (const [id, entry] of Object.entries(estimate.tasks)) if (!runner.schedule.tasks[id]) runner.schedule.tasks[id] = entry;
  runner.schedule.roles = Object.fromEntries(runner.plan.roles.map(role => {
    const entries = runner.plan.tasks.filter(task => task.roleId === role.id).map(task => runner.schedule.tasks[task.id]).filter(Boolean);
    return [role.id, { estimateMinutes: entries.reduce((sum, entry) => sum + (entry.estimateMinutes || 0), 0), deadlineAt: entries.length ? new Date(Math.max(...entries.map(entry => Date.parse(entry.deadlineAt)))).toISOString() : null }];
  }));
  runner.schedule.projectedFinishAt = estimate.projectedFinishAt;
  runner.schedule.remainingMinutes = estimate.estimatedMinutes;
}
function observeSchedule(runner, now = Date.now()) {
  const schedule = runner.schedule;
  if (!Number.isFinite(schedule?.activeSince)) return;
  schedule.actualMs = (schedule.actualMs || 0) + Math.max(0, now - schedule.activeSince);
  schedule.activeSince = ['running', 'reviewing', 'pausing'].includes(runner.phase) ? now : undefined;
  if (runner.phase === 'ended') schedule.finishedAt = new Date(now).toISOString();
}
module.exports = { RULES, taskMinutes, forecast, beginSchedule, updateForecast, observeSchedule };
