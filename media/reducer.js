(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PoReducer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const AGENTS = ['opus', 'sonnet', 'sol'];
  const META = {
    opus: { name: 'OPUS · PO', short: 'Opus', role: 'Product Owner', color: '#a46bff' },
    sonnet: { name: 'SONNET', short: 'Sonnet', role: 'UI · docs', color: '#ff9a3c' },
    sol: { name: 'SOL 6.1', short: 'Sol', role: 'API · tests', color: '#35c8ff' }
  };
  const STATUS = {
    idle: 'chờ', coordinating: 'điều phối', planning: 'lập kế hoạch', assigned: 'được giao', working: 'đang làm',
    done: 'xong', review: 'review', approved: 'đã duyệt', rework: 'sửa lại', error: 'lỗi', stopped: 'đã dừng', paused: 'tạm dừng', ended: 'kết thúc'
  };
  const OPEN = new Set(['assigned', 'working', 'rework']);
  const PALETTE = ['#a46bff', '#ff9a3c', '#35c8ff', '#74d7a5', '#f28fc4', '#d8c36a', '#929dff', '#5fd4d1', '#e7997d'];
  function validAgent(id) { return typeof id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id); }
  function agentIds(state) { return Object.keys(state.agents); }
  function meta(state, id) { return state.metadata[id] || META[id] || { name: id || 'Agent', short: id || 'Agent', role: '', color: PALETTE[2] }; }
  function blankAgent() { return { status: 'idle', task: '', path: '', text: '', bubble: '', events: 0, lastTs: 0, files: 0, model: '' }; }

  function folderKey(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
  }
  function baseName(path) { return String(path || '').split('/').pop(); }
  function ms(ts) { const value = Date.parse(ts); return Number.isFinite(value) ? value : 0; }

  function emptyState() {
    const agents = {};
    for (const agent of AGENTS) {
      agents[agent] = blankAgent();
    }
    return { title: '', startedAt: 0, endedAt: 0, ended: false, endText: '', lastTs: 0, agents, metadata: {}, coordinator: 'opus', dynamic: false, tasks: [], files: {},
      folders: {}, links: {}, log: [], counts: { events: 0, errors: 0, reworks: 0 } };
  }
  function link(state, from, to, kind) {
    const key = from + '>' + to + ':' + kind;
    (state.links[key] = state.links[key] || { from, to, kind, count: 0 }).count++;
  }
  function latest(state, agent, predicate) {
    for (let index = state.tasks.length - 1; index >= 0; index--) {
      const task = state.tasks[index];
      if (task.agent === agent && (!predicate || predicate(task))) return task;
    }
    return null;
  }
  function newTask(state, agent, title, event) {
    const task = { id: state.tasks.length + 1, taskId: event.taskId || '', agent, title: title || 'Việc', path: event.path || '', status: 'assigned',
      files: [], assignTs: ms(event.ts), startTs: 0, endTs: 0, reviewTs: 0, approvedTs: 0, reworks: 0, note: '' };
    state.tasks.push(task);
    return task;
  }
  function taskFor(state, agent, event) {
    let task = null;
    if (event.taskId) return state.tasks.find(item => item.agent === agent && item.taskId === event.taskId) || newTask(state, agent, event.task || event.text, event);
    if (event.task) task = latest(state, agent, item => item.title === event.task && item.status !== 'approved');
    if (!task) task = latest(state, agent, item => OPEN.has(item.status) || item.status === 'error');
    if (!task) task = newTask(state, agent, event.task || event.text, event);
    return task;
  }
  function ensureFolder(state, path) {
    const key = folderKey(path);
    return state.folders[key] || (state.folders[key] = { key, files: [], agent: '', count: 0 });
  }

  function apply(state, event) {
    if (!validAgent(event.agent)) return state;
    if (event.type === 'team' && Array.isArray(event.members)) {
      if (!state.dynamic) { state.agents = {}; state.metadata = {}; state.dynamic = true; }
      for (const [index, member] of event.members.slice(0, 9).entries()) {
        if (!validAgent(member.id)) continue;
        state.agents[member.id] = state.agents[member.id] || blankAgent();
        if (typeof member.model === 'string') state.agents[member.id].model = member.model;
        state.metadata[member.id] = { name: String(member.name || member.id).slice(0, 100), short: String(member.name || member.id).slice(0, 22), role: String(member.responsibility || '').slice(0, 500), color: PALETTE[index % PALETTE.length] };
      }
      if (validAgent(event.coordinator) && state.agents[event.coordinator]) state.coordinator = event.coordinator;
    }
    if (!state.agents[event.agent]) state.agents[event.agent] = blankAgent();
    const agent = state.agents[event.agent];
    if (!agent) return state;
    const time = ms(event.ts);
    if (time) state.lastTs = time;
    if (!state.startedAt) state.startedAt = time;
    state.counts.events++;
    agent.events++;
    agent.lastTs = time;
    if (event.type !== 'stall') agent.stalled = false;
    if (typeof event.model === 'string') agent.model = event.model;
    state.log.push(event);
    switch (event.type) {
      case 'paused':
        agent.status = 'paused'; agent.text = event.text || '';
        if (event.taskId) taskFor(state, event.agent, event).status = 'paused';
        if (event.agent === state.coordinator) state.paused = true;
        break;
      case 'resumed':
        state.paused = false; state.ended = false; state.endedAt = 0;
        agent.status = 'coordinating';
        break;
      case 'session':
        state.title = event.title || state.title;
        if (state.counts.events === 1 || state.sessionEmpty) { state.agents = {}; state.metadata = {}; state.dynamic = true; state.sessionEmpty = true; }
        break;
      case 'start':
        state.paused = false;
        state.sessionEmpty = false;
        state.title = event.title || event.text || state.title;
        state.startedAt = time || state.startedAt;
        agent.status = 'coordinating';
        agent.bubble = 'Bắt đầu';
        break;
      case 'plan':
        agent.status = 'planning';
        agent.text = event.text || event.task || '';
        agent.task = agent.text;
        agent.bubble = 'Lập kế hoạch';
        break;
      case 'ready':
        agent.status = 'idle'; agent.text = event.text || ''; agent.bubble = 'Chờ chọn model';
        break;
      case 'assign': {
        const target = state.agents[event.to];
        if (!target) break;
        const title = event.task || event.text;
        let task = event.taskId ? state.tasks.find(item => item.taskId === event.taskId) : latest(state, event.to, item => item.status === 'assigned' && item.title === title);
        if (!task) task = newTask(state, event.to, title, event);
        if (event.path) { task.path = event.path; ensureFolder(state, event.path); }
        target.status = 'assigned';
        target.task = task.title;
        target.path = task.path;
        target.bubble = '📋 ' + task.title;
        agent.status = 'coordinating';
        agent.task = 'Giao việc: ' + task.title;
        agent.bubble = 'Giao việc';
        link(state, event.agent, event.to, 'assign');
        break;
      }
      case 'working':
      case 'file': {
        const task = taskFor(state, event.agent, event);
        const appliedAfterEnd = state.ended && event.type === 'file';
        if (!appliedAfterEnd) task.status = 'working';
        if (event.type === 'working') {
          task.note = event.text || (task.reworks ? 'Đang làm lại theo yêu cầu của PO.' : 'Đang thực hiện.');
          task.endTs = 0; task.reviewTs = 0; task.approvedTs = 0;
          agent.text = '';
        }
        if (!task.startTs) task.startTs = time;
        if (!appliedAfterEnd) agent.status = 'working';
        agent.task = task.title;
        if (event.path) {
          if (!task.path) task.path = event.path;
          agent.path = event.path;
          const folder = ensureFolder(state, event.path);
          if (event.type === 'file') {
            if (!task.files.includes(event.path)) task.files.push(event.path);
            let file = state.files[event.path];
            if (!file) { file = state.files[event.path] = { path: event.path, agent: event.agent, count: 0, lastTs: 0, folder: folder.key }; agent.files++; }
            file.count++; file.agent = event.agent; file.lastTs = time;
            folder.files = [baseName(event.path), ...folder.files.filter(name => name !== baseName(event.path))].slice(0, 4);
            folder.agent = event.agent;
            folder.count++;
            link(state, event.agent, 'folder:' + folder.key, 'edit');
          }
        }
        agent.bubble = event.type === 'file' ? '✎ ' + baseName(event.path) : '⚙ ' + task.title;
        break;
      }
      case 'retry':
        if (event.taskId) taskFor(state, event.agent, event).note = event.text || 'Đang thử lại kết nối.';
        agent.text = event.text || ''; agent.bubble = event.text || 'Đang thử lại';
        break;
      case 'handover':
        agent.status = event.phase === 'planning' ? 'planning' : event.phase === 'reviewing' ? 'review' : 'coordinating';
        if (event.model) agent.model = event.model;
        agent.text = event.text || ''; agent.bubble = (event.model || 'Model mới') + ' tiếp quản PO';
        break;
      case 'model_failover':
        if (event.nextModel) agent.model = event.nextModel;
        if (event.taskId) taskFor(state, event.agent, event).note = event.text || '';
        agent.stalled = false; agent.text = event.text || ''; agent.bubble = 'PO đổi model → ' + (event.nextModel || '');
        break;
      case 'stall':
        agent.stalled = true; agent.text = event.text || ''; agent.bubble = '⏳ ' + (event.text || 'Đang chờ model');
        break;
      case 'model_switch_requested':
        agent.modelSwitch = { model: event.nextModel, deadline: event.deadline, requestedAt: event.requestedAt };
        agent.bubble = 'Đang bàn giao → ' + event.nextModel;
        break;
      case 'model_switch_applied':
        agent.model = event.nextModel; agent.modelSwitch = null;
        agent.text = event.text || ''; agent.bubble = 'Đã đổi → ' + event.nextModel;
        break;
      case 'model_switch_interrupted': {
        const task = taskFor(state, event.agent, event);
        task.status = 'assigned'; task.note = event.text || '';
        agent.status = 'assigned'; agent.bubble = 'Tiếp tục với model mới';
        break;
      }
      case 'note':
        agent.text = event.text || '';
        agent.bubble = event.text || '';
        break;
      case 'queued': {
        if (!validAgent(event.to)) break;
        const target = state.agents[event.to] || (state.agents[event.to] = blankAgent());
        if (!state.tasks.some(task => task.taskId === event.taskId)) newTask(state, event.to, event.task, event);
        if (target.status === 'idle') target.status = 'assigned';
        break;
      }
      case 'result': {
        const task = taskFor(state, event.agent, event);
        task.result = event.text || ''; task.proposedPaths = Array.isArray(event.paths) ? event.paths : [];
        break;
      }
      case 'stopped': {
        agent.status = 'stopped'; agent.bubble = 'Đã dừng'; agent.text = event.text || '';
        const task = event.taskId ? taskFor(state, event.agent, event) : latest(state, event.agent, item => OPEN.has(item.status));
        if (task) { task.status = 'stopped'; task.endTs = time; task.note = event.text || ''; }
        break;
      }
      case 'done': {
        const task = taskFor(state, event.agent, event);
        task.status = 'done';
        task.endTs = time;
        if (!task.startTs) task.startTs = task.assignTs || time;
        task.note = event.text || '';
        agent.status = 'done';
        agent.task = task.title;
        agent.bubble = '✓ Xong';
        link(state, event.agent, event.to || state.coordinator, 'done');
        break;
      }
      case 'review': {
        const target = state.agents[event.to];
        const task = event.to ? (event.taskId ? state.tasks.find(item => item.taskId === event.taskId) : latest(state, event.to, item => item.status === 'done' || item.status === 'review')) : null;
        if (task) { task.status = 'review'; task.reviewTs = time; }
        agent.status = 'review';
        agent.task = 'Review: ' + (event.task || (task && task.title) || '');
        agent.bubble = '🔍 Review ' + (event.to ? meta(state, event.to).name : '');
        if (target) target.status = 'review';
        break;
      }
      case 'approved': {
        const target = state.agents[event.to];
        const task = event.to ? (event.taskId ? state.tasks.find(item => item.taskId === event.taskId) : latest(state, event.to, item => item.status === 'review' || item.status === 'done')) : null;
        if (task) { task.status = 'approved'; task.approvedTs = time; }
        if (target) { target.status = 'approved'; target.bubble = ''; }
        agent.status = 'coordinating';
        agent.bubble = '✅ Duyệt';
        break;
      }
      case 'rework': {
        const target = state.agents[event.to];
        const task = event.to ? (event.taskId ? state.tasks.find(item => item.taskId === event.taskId) : latest(state, event.to, item => item.status === 'review' || item.status === 'done')) : null;
        if (task) { task.status = 'rework'; task.reworks++; task.endTs = 0; task.note = event.text || ''; }
        if (target) { target.status = 'rework'; target.bubble = '↺ ' + (event.text || 'sửa lại'); }
        agent.status = 'coordinating';
        agent.bubble = '↺ Yêu cầu sửa';
        state.counts.reworks++;
        if (event.to) link(state, event.agent, event.to, 'rework');
        break;
      }
      case 'error': {
        agent.status = 'error';
        agent.text = event.text || '';
        agent.bubble = '⚠ ' + (event.text || 'lỗi');
        const task = event.taskId ? taskFor(state, event.agent, event) : latest(state, event.agent, item => OPEN.has(item.status));
        if (task) { task.status = 'error'; task.note = event.text || ''; task.lastError = event.text || ''; }
        state.counts.errors++;
        break;
      }
      case 'end':
        state.paused = false;
        state.ended = true;
        state.endedAt = time;
        state.endText = event.text || '';
        agent.status = 'ended';
        agent.bubble = '🏁 ' + (event.text || 'Hoàn thành');
        break;
      default:
        break;
    }
    return state;
  }
  function reduce(events) {
    const state = emptyState();
    for (const event of events) apply(state, event);
    return state;
  }
  return { AGENTS, META, STATUS, OPEN, validAgent, agentIds, meta, folderKey, baseName, ms, emptyState, apply, reduce };
});
