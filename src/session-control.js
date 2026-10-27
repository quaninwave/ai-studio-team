'use strict';
const { pushHistory } = require('./history');
const crypto = require('crypto');
const { validatePlan } = require('./plan');
const { contract, compactResults } = require('./reports');
const { hold } = require('./usage');
const { imageParts, describe } = require('./attachments');
const timestamp = () => new Date().toISOString();
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const CONTROL_SCHEMA = `Return ONLY JSON {"reply":"answer in the CEO's language","newRoles":[],"newTasks":[],"rework":[{"taskId":"existing ID","instruction":"specific correction"}],"decisions":[{"question":"meaningful CEO choice","reason":"tradeoff","options":["choice one","choice two"],"blocking":true}]}. New roles/tasks use the existing plan schema, exact model catalog and acceptance criteria. Add work only if the CEO requests it; status questions do not change completed work. Rework existing tasks for requested changes, preserve independent completed tasks. Ask the CEO only for meaningful scope, art direction or product tradeoffs. PO/Tech resolve routine technical errors. Never request credentials. Do not execute external actions in this conversation; propose validated work instead.`;
class SessionControl {
  constructor(runner, data = {}) {
    this.runner = runner; this.messages = data.messages || []; this.decisions = data.decisions || []; this.revision = data.revision || 0;
    // A quick reply interrupted by a reload goes back to the normal queue.
    for (const item of this.messages) if (item.status === 'answering') item.status = 'queued';
  }
  snapshot() { return { messages: this.messages, decisions: this.decisions, revision: this.revision }; }
  context() { return { messages: this.messages.slice(-30).map(({ role, text, status, attachments }) => ({ role, text: text + describe(attachments), status })), decisions: this.decisions }; }
  async enqueue(value, attachments = []) {
    if (!text(value, 8000) && !(attachments.length && typeof value === 'string' && value.length <= 8000)) throw new Error('Tin nhắn cần từ 1 đến 8000 ký tự.');
    if (this.messages.filter(item => item.status === 'queued').length >= 20) throw new Error('PO còn 20 tin đang chờ. Chờ PO xử lý trước khi gửi thêm.');
    const message = { id: crypto.randomUUID(), role: 'user', text: value.trim() || '(đính kèm)', createdAt: timestamp(), status: 'queued', ...(attachments.length ? { attachments } : {}) };
    this.messages.push(message); this.revision++;
    await this.runner.saveState(); await this.runner.event('lead', 'note', { text: 'CEO: ' + message.text + (attachments.length ? ' · ' + attachments.length + ' đính kèm' : '') }); return message;
  }
  addDecisions(items) {
    if (items == null) return [];
    if (!Array.isArray(items) || items.length > 8) throw new Error('Danh sách quyết định không hợp lệ.');
    const clean = items.map(item => {
      if (!text(item.question, 1200) || !text(item.reason, 2400) || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 5 || item.options.some(option => !text(option, 600)) || new Set(item.options).size !== item.options.length) throw new Error('Quyết định cần câu hỏi, lý do và 2–5 lựa chọn khác nhau.');
      return { id: crypto.randomUUID(), question: item.question, reason: item.reason, options: item.options, blocking: item.blocking !== false, createdAt: timestamp(), status: 'pending' };
    });
    return clean.filter(item => !this.decisions.some(previous => previous.status === 'pending' && previous.question === item.question));
  }
  async answer(id, choice, custom = false) {
    const decision = this.decisions.find(item => item.id === id);
    if (custom) { choice = typeof choice === 'string' ? choice.trim().slice(0, 2000) : ''; if (!choice) throw new Error('Nhập lựa chọn khác trước khi gửi.'); }
    if (!decision || decision.status !== 'pending' || !custom && !decision.options.includes(choice)) throw new Error('Lựa chọn không còn hợp lệ hoặc đã được trả lời.');
    if (this.messages.filter(item => item.status === 'queued').length >= 20) throw new Error('PO còn nhiều tin đang chờ.');
    const message = { id: crypto.randomUUID(), role: 'user', text: 'Quyết định CEO cho “' + decision.question + '”: ' + (custom ? '(lựa chọn khác) ' : '') + choice, createdAt: timestamp(), status: 'queued', decisionId: id };
    decision.status = 'answered'; decision.answer = choice; decision.custom = !!custom; decision.answeredAt = timestamp();
    this.messages.push(message); this.revision++;
    await this.runner.saveState(); await this.runner.event('lead', 'note', { text: message.text });
  }
  async retry(id) {
    const message = this.messages.find(item => item.id === id && item.role === 'user' && item.status === 'error');
    if (!message) throw new Error('Tin nhắn không còn cần gửi lại.');
    message.status = 'queued'; delete message.error; this.revision++; await this.runner.saveState();
  }
  // While the team is busy, PO answers immediately from the live session state.
  // Messages that need plan changes stay queued for the next scheduling boundary.
  async quickReply(id, parseObject) {
    const message = this.messages.find(item => item.id === id && item.role === 'user' && item.status === 'queued');
    if (!message) return false;
    const r = this.runner;
    message.status = 'answering'; message.readAt ||= timestamp(); this.revision++;
    await r.saveState();
    await r.event('lead', 'note', { text: 'PO đang đọc tin nhắn của CEO…' });
    const tasks = (r.plan?.tasks || []).map(task => ({ id: task.id, title: task.title, role: task.roleId, model: r.roles[task.roleId], status: r.taskStatus.get(task.id) || 'pending', summary: r.results[task.id]?.summary?.slice(0, 600), error: r.results[task.id]?.error?.slice(0, 400), deadline: r.schedule?.tasks?.[task.id] }));
    const prompt = 'You are the Product Owner of this Unity game team, answering the CEO in chat while the team keeps working. Reply in the CEO\'s language, concisely and honestly, using ONLY the supplied live state: what is done, in progress, blocked or being reworked, by whom, ETA and next steps. Never claim unverified tests or Unity changes. Return ONLY JSON {"reply":"answer to the CEO","needsPlanChange":true|false}. Set needsPlanChange true only when the CEO asks to add, change, redo or stop work; then say in the reply that you will apply it at the next scheduling checkpoint without interrupting running tasks.';
    const state = { message: message.text + describe(message.attachments), request: r.request?.slice(0, 4000), phase: r.phase, coordinator: r.roles.lead, reviewRound: r.reviewRound || 0, tasks, schedule: r.schedule ? { projectedFinishAt: r.schedule.projectedFinishAt, originalFinishAt: r.schedule.originalFinishAt } : undefined, holdReason: r.holdReason || undefined, lastReview: r.reviews?.at(-1) ? { summary: r.reviews.at(-1).summary?.slice(0, 1500), issues: r.reviews.at(-1).issues?.slice(0, 6) } : undefined, conversation: this.messages.slice(-10).map(({ role, text, status }) => ({ role, text: text.slice(0, 1500), status })) };
    const images = await imageParts(r.directory, r.run, message.attachments);
    try {
      const response = await r.measured('lead', 'text', retry => r.client.complete(r.roles.lead, [{ role: 'system', content: prompt }, { role: 'user', content: images.length ? [{ type: 'text', text: JSON.stringify(state) }, ...images] : JSON.stringify(state) }], [], r.abort.signal, retry));
      const parsed = parseObject(response.text || '');
      if (!text(parsed.reply, 12000)) throw new Error('PO chưa trả nội dung phản hồi.');
      const followUp = parsed.needsPlanChange === true;
      message.status = followUp ? 'queued' : 'processed';
      if (followUp) message.quickReplied = true;
      this.messages.push({ id: crypto.randomUUID(), role: 'assistant', text: parsed.reply, replyTo: message.id, model: r.roles.lead, createdAt: timestamp(), status: 'processed', quick: true });
      this.revision++;
      await r.saveState(); await r.event('lead', 'note', { text: 'PO: ' + parsed.reply });
      return true;
    } catch (error) {
      // Fall back to the normal queue; the PO still answers at the next checkpoint.
      if (message.status === 'answering') message.status = 'queued';
      this.revision++;
      await r.saveState().catch(() => {});
      if (!r.abort.signal.aborted) await r.event('lead', 'note', { text: 'PO chưa trả lời nhanh được (' + String(error.message || error).slice(0, 200) + '). Tin nhắn vẫn được xử lý ở mốc tiếp theo.' }).catch(() => {});
      return false;
    }
  }
  async drain(parseObject) {
    if (this.draining) return this.draining;
    this.draining = this.process(parseObject);
    try { return await this.draining; } finally { this.draining = null; }
  }
  async process(parseObject) {
    let changed = false;
    for (;;) {
      const message = this.messages.find(item => item.role === 'user' && item.status === 'queued');
      if (!message) break;
      const r = this.runner;
      message.status = 'answering'; message.readAt ||= timestamp(); this.revision++;
      await r.saveState(); await r.event('lead', 'note', { text: 'PO đã đọc tin nhắn CEO, đang soạn trả lời…' });
      let repair = '';
      for (let attempt = 0; ; attempt++) try {
        const response = parseObject(await r.ask('lead', 'You are the PO continuing this exact session. ' + CONTROL_SCHEMA + (repair ? ' Your previous answer was rejected by validation: ' + repair + ' Fix it: reuse existing roles (max 8 worker positions in total) instead of adding new ones, keep the whole plan at most 60 tasks, keep IDs valid and dependencies acyclic.' : ''), JSON.stringify({ message: { ...message, text: message.text + describe(message.attachments) }, request: r.request, plan: r.plan, models: r.models, status: Object.fromEntries(r.taskStatus), results: compactResults(r.results), conversation: this.context() }), !!r.root, await imageParts(r.directory, r.run, message.attachments)));
        if (!text(response.reply, 12000)) throw new Error('PO chưa trả nội dung phản hồi.');
        const newRoles = response.newRoles || [], newTasks = response.newTasks || [], rework = response.rework || [];
        if (![newRoles, newTasks, rework].every(Array.isArray)) throw new Error('PO trả thay đổi kế hoạch không hợp lệ.');
        const candidate = validatePlan({ ...r.plan, roles: [...r.plan.roles, ...newRoles], tasks: [...r.plan.tasks, ...newTasks.map(task => r.managed ? contract(task) : task)] }, r.models);
        if (!r.root && candidate.tasks.some(task => task.scope.length)) throw new Error('Session chưa được cấp quyền project.');
        const retry = new Set(newTasks.map(task => task.id));
        for (const task of newTasks) if (r.stoppedAgents.has(task.roleId)) throw new Error('Không thể giao thêm việc cho vị trí đã dừng.');
        for (const item of rework) {
          const task = candidate.tasks.find(task => task.id === item.taskId);
          if (!task || !text(item.instruction, 8000) || r.stoppedAgents.has(task.roleId)) throw new Error('Yêu cầu làm lại không hợp lệ hoặc vị trí đã dừng.');
          retry.add(item.taskId);
        }
        const decisions = this.addDecisions(response.decisions);
        if (retry.size) {
          for (const task of candidate.tasks.filter(task => task.kind === 'tech')) retry.add(task.id);
          let expanded;
          do { expanded = false; for (const task of candidate.tasks) if (!retry.has(task.id) && task.dependsOn.some(id => retry.has(id))) { retry.add(task.id); expanded = true; } } while (expanded);
          r.history = pushHistory(r.history, { reason: 'ceo_followup', messageId: message.id, results: JSON.parse(JSON.stringify(r.results)) });
          r.plan.roles = candidate.roles; r.plan.tasks = candidate.tasks;
          for (const role of candidate.roles) r.roles[role.id] = role.model;
          r.feedback ||= {};
          for (const item of rework) r.feedback[item.taskId] = item.instruction;
          for (const id of retry) {
            const task = candidate.tasks.find(task => task.id === id);
            const paths = new Set((r.results[id]?.files || []).map(file => file.path));
            r.appliedPaths = (r.appliedPaths || []).filter(relative => !paths.has(relative));
            r.taskStatus.set(id, 'rework'); r.pendingTasks?.set(id, task);
            // Keep rejected results in history, never reuse rejected generated images.
            delete r.results[id];
          }
          r.reviewRound = 0; r.reportOutdated = true; r.delivery = undefined; r.finalOutcome = {}; r.proposals = []; changed = true;
          if (r.phase === 'ended') r.phase = 'paused';
          await r.publishTeam();
        }
        this.decisions.push(...decisions);
        message.status = 'processed';
        this.messages.push({ id: crypto.randomUUID(), role: 'assistant', text: response.reply, replyTo: message.id, model: r.roles.lead, createdAt: timestamp(), status: 'processed' });
        await r.saveState(); await r.event('lead', 'note', { text: 'PO: ' + response.reply });
        break;
      } catch (error) {
        if (error.code === 'SESSION_HOLD' || r.abort.signal.aborted) throw error;
        // Plan validation mistakes are the PO's to fix; give it one self-repair round before holding the session.
        if (attempt === 0 && !/network|fetch|timeout|ECONN|socket/i.test(error.message)) { repair = error.message; await r.event('lead', 'note', { text: 'PO tự sửa thay đổi kế hoạch không hợp lệ: ' + error.message }); continue; }
        message.status = 'error'; message.error = error.message;
        await r.saveState(); await r.event('lead', 'error', { text: 'Chưa xử lý được tin nhắn CEO: ' + error.message });
        break;
      }
    }
    return changed;
  }
  check() {
    if (this.messages.some(item => item.role === 'user' && item.status === 'error')) throw hold('PO chưa xử lý được tin nhắn CEO. Mở Chat với PO và bấm Gửi lại trước khi tiếp tục.');
    if (this.decisions.some(item => item.status === 'pending' && item.blocking)) throw hold('Cần bạn quyết định trước khi giao việc tiếp. Mở Chat với PO để chọn.');
  }
}
module.exports = { SessionControl, CONTROL_SCHEMA };
