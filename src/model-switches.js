'use strict';
const crypto = require('node:crypto');
const { isImageModel } = require('./images');

const GRACE_MS = 180000;
const interrupted = agent => Object.assign(new Error('Đã hết thời gian bàn giao; chuyển sang model mới.'), { code: 'MODEL_SWITCH', agent });
const isSwitch = error => error?.code === 'MODEL_SWITCH';
function validateModelChange(current, target, agent, models) {
  if (!(models || []).some(model => (model.id || model) === target)) throw new Error('Model không có trong danh sách proxy.');
  if (agent === 'lead' && isImageModel(target) || isImageModel(current) !== isImageModel(target)) throw new Error('Giữ đúng loại model: vị trí văn bản/PO dùng model văn bản; vị trí tạo ảnh dùng model ảnh.');
}
function changeSavedModel(data, agent, model, models, now = Date.now()) {
  const role = data.plan?.roles.find(role => role.id === agent);
  if (agent !== 'lead' && !role || agent === 'lead' && !data.coordinator) throw new Error('Vị trí không tồn tại trong session này.');
  const previousModel = agent === 'lead' ? data.coordinator : role.model;
  validateModelChange(previousModel, model, agent, models);
  const pending = data.modelSwitches?.pending?.[agent];
  if (previousModel === model && !pending) return null;
  const record = { ...(pending?.model === model ? pending : { id: crypto.randomUUID(), agent, previousModel, model, requestedAt: now, deadline: now + GRACE_MS }), appliedAt: now, forced: false };
  if (role) role.model = model; else data.coordinator = model;
  data.manualModels = { ...data.manualModels, [agent]: model };
  if (!pending || pending.wasStopped) data.stoppedAgents = (data.stoppedAgents || []).filter(id => id !== agent);
  data.modelSwitches ||= {}; data.modelSwitches.pending ||= {}; delete data.modelSwitches.pending[agent];
  data.modelSwitches.history = [...(data.modelSwitches.history || []), record].slice(-50);
  if (agent === 'lead') {
    data.leadership = { ...data.leadership, consecutiveFailures: 0, failedModel: '', lastFailure: null, handoffs: [...(data.leadership?.handoffs || []), { previousModel, model, source: 'user', reason: 'CEO đổi model PO', ts: new Date(now).toISOString() }].slice(-20) };
  }
  return { ts: new Date(now).toISOString(), run: data.run, agent, type: 'model_switch_applied', model, previousModel, nextModel: model, forced: false, text: 'Đã đổi model sang ' + model + '; giữ kết quả và session hiện tại.' };
}
function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    // Attach to the operation even when already aborted, consuming any late rejection.
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}
class ModelSwitches {
  constructor(runner, runtime = {}, saved = {}) {
    this.runner = runner; this.now = runtime.now || Date.now;
    this.schedule = runtime.setTimeout || setTimeout; this.clear = runtime.clearTimeout || clearTimeout;
    this.pending = new Map(Object.entries(saved.pending || {})); this.history = (saved.history || []).slice(-50); this.timers = new Map();
  }
  snapshot() { return { pending: Object.fromEntries(this.pending), history: this.history }; }
  busy(agent) {
    return this.runner.agentControllers.has(agent) || !!this.runner.modelCalls.get(agent)?.size || this.runner.plan?.tasks.some(task => task.roleId === agent && this.runner.taskStatus.get(task.id) === 'working');
  }
  async request(agent, model, requestedAt = this.now()) {
    const r = this.runner;
    if (agent !== 'lead' && !r.plan?.roles.some(role => role.id === agent)) throw new Error('Vị trí không tồn tại trong session này.');
    validateModelChange(r.roles[agent], model, agent, r.models);
    const existing = this.pending.get(agent);
    if (existing) {
      if (existing.model !== model) throw new Error('Vị trí đang bàn giao. Chờ lần đổi hiện tại hoàn tất.');
      return { state: 'waiting', ...existing };
    }
    if (r.roles[agent] === model) return { state: 'unchanged', model };
    const start = Math.min(this.now(), Number.isFinite(requestedAt) ? requestedAt : this.now());
    const request = { id: crypto.randomUUID(), agent, previousModel: r.roles[agent], model, requestedAt: start, deadline: start + GRACE_MS, wasStopped: r.stoppedAgents.has(agent) };
    this.pending.set(agent, request);
    if (!this.busy(agent)) { await this.apply(agent, request.id); return { state: 'applied', ...request }; }
    const timer = this.schedule(() => this.apply(agent, request.id, true).catch(error => r.event(agent, 'note', { text: 'Lỗi lưu bàn giao model: ' + error.message })), Math.max(0, request.deadline - this.now()));
    timer?.unref?.(); this.timers.set(agent, timer);
    await r.saveState();
    await r.event(agent, 'model_switch_requested', { ...request, model: request.previousModel, nextModel: model, text: 'Đang hoàn tất phần hiện tại trước khi đổi sang ' + model + '. Hạn tối đa 3 phút từ khi bấm Đổi.' });
    return { state: 'waiting', ...request };
  }
  async apply(agent, id, forced = false) {
    const request = this.pending.get(agent);
    if (!request || request.id !== id) return;
    this.pending.delete(agent); this.clear(this.timers.get(agent)); this.timers.delete(agent);
    const r = this.runner;
    if (forced) {
      r.agentControllers.get(agent)?.abort(interrupted(agent));
      for (const call of r.modelCalls.get(agent) || []) call.abort(interrupted(agent));
    }
    r.roles[agent] = request.model;
    r.manualModels ||= {}; r.manualModels[agent] = request.model;
    const role = r.plan?.roles.find(role => role.id === agent);
    if (role) role.model = request.model;
    if (request.wasStopped) r.stoppedAgents.delete(agent);
    const record = { ...request, appliedAt: this.now(), forced };
    this.history = [...this.history, record].slice(-50);
    if (agent === 'lead') {
      r.leadership.consecutiveFailures = 0; r.leadership.failedModel = ''; r.leadership.lastFailure = null;
      r.leadership.handoffs = [...r.leadership.handoffs, { previousModel: request.previousModel, model: request.model, source: 'user', reason: 'CEO đổi model PO', ts: new Date(record.appliedAt).toISOString() }].slice(-20);
    }
    this.requeueFailures(agent);
    await r.saveState();
    await r.event(agent, 'model_switch_applied', { previousModel: request.previousModel, nextModel: request.model, forced, deadline: request.deadline, text: (forced ? 'Đã đạt hạn 3 phút. ' : '') + 'Đã đổi model sang ' + request.model + '; giữ kết quả và session hiện tại.' });
  }
  requeueFailures(agent) {
    const r = this.runner;
    if (r.phase !== 'running' || !r.pendingTasks || r.abort.signal.aborted) return;
    const retry = new Set(r.plan.tasks.filter(task => task.roleId === agent && ['failed', 'blocked', 'stopped'].includes(r.taskStatus.get(task.id))).map(task => task.id));
    let expanded;
    do { expanded = false; for (const task of r.plan.tasks) if (!retry.has(task.id) && task.dependsOn.some(id => retry.has(id)) && r.taskStatus.get(task.id) !== 'done') { retry.add(task.id); expanded = true; } } while (expanded);
    for (const task of r.plan.tasks) if (retry.has(task.id) && !r.stoppedAgents.has(task.roleId)) { r.taskStatus.set(task.id, 'queued'); r.pendingTasks.set(task.id, task); }
  }
  async finish(agent, boundary = false) {
    const request = this.pending.get(agent);
    if (request && (boundary || !this.busy(agent))) await this.apply(agent, request.id);
  }
  async restore() {
    // No old model requests survive an extension-host reload. Apply the saved
    // choice before dispatch; never start a fresh three-minute window.
    for (const [agent, request] of [...this.pending]) {
      validateModelChange(this.runner.roles[agent], request.model, agent, this.runner.models);
      await this.apply(agent, request.id);
    }
  }
  dispose() { for (const timer of this.timers.values()) this.clear(timer); this.timers.clear(); }
}
module.exports = { ModelSwitches, GRACE_MS, interrupted, isSwitch, abortable, validateModelChange, changeSavedModel };
