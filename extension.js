'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./src/store.js');
const { startDemo } = require('./src/demo.js');
const R = require('./media/reducer.js');
const { ProxyClient, normalizeBase } = require('./src/proxy');
const { TeamRunner, safeRelative } = require('./src/team-runner');
const { projectDirectory } = require('./src/project');
const { validatePlan } = require('./src/plan');
const { isImageModel, imageArtifact } = require('./src/images');
const { McpTools, parseServerInput } = require('./src/mcp');
const { discover } = require('./src/toolbox');
const { McpHub } = require('./src/mcp-hub');
const { managedPlan } = require('./src/reports');
const { ErrorNotices, completionNotice } = require('./src/diagnostics');
const { changeSavedModel } = require('./src/model-switches');
const { deliveryReport } = require('./src/delivery');
const { parseObject } = require('./src/team-runner');
const { forecast, RULES } = require('./src/schedule');
const { saveAttachments } = require('./src/attachments');
const sessionControls = new Map();

function configuredMcpServers() {
  const global = extensionContext.globalState.get('mcpServers') || [];
  const local = extensionContext.workspaceState.get('mcpServers') || [];
  return [...new Map([...global, ...local].map(server => [server.id, server])).values()];
}
async function saveMcpServer(server) {
  const state = workspaceRoots().length ? extensionContext.workspaceState : extensionContext.globalState;
  const servers = state.get('mcpServers') || [];
  await state.update('mcpServers', [...servers.filter(item => item.id !== server.id), server]);
}
async function connectUnityMcp() {
  if (!vscode.workspace.isTrusted) throw new Error('Project cần trusted để kết nối MCP.');
  const roots = workspaceRoots();
  if (!roots.length) throw new Error('Mở project Unity trong VS Code trước khi kết nối.');
  const server = { id: 'unity', type: 'http', url: 'http://127.0.0.1:8080/mcp' };
  if (!configuredMcpServers().some(item => item.id === server.id) && configuredMcpServers().length >= 8) throw new Error('Tối đa 8 MCP server.');
  const tools = new McpTools([server]);
  try {
    await tools.connect();
    if (tools.errors.length || !tools.clients.length) throw new Error('Chưa kết nối được Unity MCP. Trong Unity: Window → MCP for Unity → HTTP Local → Start Server / Connect.');
    const response = await tools.clients[0].readResource({ uri: 'mcpforunity://project/info' }, { timeout: 15000 });
    const project = response.contents.filter(item => item.text).map(item => JSON.parse(item.text)).find(item => item.success && item.data?.projectRoot)?.data;
    if (!project || !roots.some(root => sameRoot(root, project.projectRoot))) throw new Error('Unity MCP đang nối project khác. Mở đúng project Unity và kết nối lại.');
    await saveMcpServer(server);
    output.appendLine('Unity MCP connected: ' + project.projectRoot + ' · ' + tools.definitions.length + ' tools · ' + server.url);
    await vscode.window.showInformationMessage('Unity MCP đã kết nối ' + project.projectName + ' · ' + tools.definitions.length + ' công cụ. Đã lưu cho project này.');
    return { project: project.projectRoot, tools: tools.definitions.length, url: server.url };
  } finally { await tools.close(); }
}

async function configureMcp() {
  if (!vscode.workspace.isTrusted) throw new Error('Project cần trusted để kết nối MCP.');
  const servers = configuredMcpServers();
  const choice = await vscode.window.showQuickPick([{ label: 'Unity MCP · project đang mở', description: 'Tự kết nối 127.0.0.1:8080/mcp', action: 'unity' }, { label: '+ Kết nối MCP', action: 'add' }, ...servers.map(server => ({ label: server.id, description: server.url || server.type, server }))], { title: 'Công cụ của PO · Unity / PC / Research' });
  if (!choice) return;
  if (choice.action === 'unity') return connectUnityMcp();
  if (choice.server) {
    const action = await vscode.window.showQuickPick(['Kiểm tra kết nối', 'Ngắt kết nối'], { title: choice.server.id });
    if (action === 'Ngắt kết nối') {
      const local = extensionContext.workspaceState.get('mcpServers') || [];
      const state = local.some(server => server.id === choice.server.id) ? extensionContext.workspaceState : extensionContext.globalState;
      await state.update('mcpServers', (state.get('mcpServers') || []).filter(server => server.id !== choice.server.id));
      await extensionContext.secrets.delete('mcp:' + choice.server.id); return;
    }
    if (!action) return;
    return testMcp([choice.server]);
  }
  if (servers.length >= 8) throw new Error('Tối đa 8 MCP server.');
  const raw = await vscode.window.showInputBox({ title: 'MCP server', prompt: 'Dán URL: http://127.0.0.1:8080/mcp. Hoặc JSON cho stdio: {"id":"pc","type":"stdio","command":"...","args":[]}.', ignoreFocusOut: true, validateInput: value => { try { parseServerInput(value); } catch (error) { return error.message; } } });
  if (!raw) return;
  const server = parseServerInput(raw);
  if (servers.some(item => item.id === server.id)) throw new Error('MCP ID đã tồn tại.');
  const token = await vscode.window.showInputBox({ title: 'MCP Bearer token (nếu có)', password: true, ignoreFocusOut: true });
  if (token === undefined) return;
  if (token.trim()) await extensionContext.secrets.store('mcp:' + server.id, token.trim());
  await saveMcpServer(server);
  await testMcp([server]);
}
async function testMcp(servers) {
  const tools = new McpTools(servers, id => extensionContext.secrets.get('mcp:' + id));
  try {
    await tools.connect();
    const content = tools.definitions.map(tool => tool.description).join('\n\n') || tools.errors.map(item => item.server + ': ' + item.error).join('\n');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'MCP: ' + tools.definitions.length + ' tools\n\n' + content }), { preview: true });
  } finally { await tools.close(); }
}
async function openLog() {
  if (!panelRun || !store.get(panelRun)) throw new Error('Chọn session thuộc project đang mở.');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(eventsDir(), panelRun + '.jsonl'))), { preview: true });
}
async function attachMcp(runner) {
  if (!runner.root || !vscode.workspace.isTrusted) return;
  runner.mcp = new McpTools(configuredMcpServers(), id => extensionContext.secrets.get('mcp:' + id));
  await runner.mcp.connect(runner.abort.signal);
  for (const error of runner.mcp.errors) await runner.event('lead', 'note', { text: error.server + ': ' + error.error });
  if (runner.mcp.definitions.length) await runner.event('lead', 'note', { text: 'PO có ' + runner.mcp.definitions.length + ' công cụ MCP. Workers nhận task và đề xuất; PO trực tiếp gọi MCP và kiểm tra kết quả.' });
  attachToolbox(runner);
  const close = runner.mcp.close.bind(runner.mcp);
  runner.mcp.close = async () => { await Promise.allSettled([close(), runner.hub?.close()]); };
  if (runner.skills?.length || runner.hub?.servers.length) await runner.event('lead', 'note', { text: 'Toolbox từ Codex/Claude: ' + (runner.skills?.length || 0) + ' skill, ' + (runner.hub?.servers.length || 0) + ' MCP (' + (runner.hub?.servers.map(server => server.id).join(', ') || 'không có') + '). Mọi vị trí đều tra cứu được; MCP chỉ khởi động khi cần.' });
}
// Imports skills, plugin skills and MCP servers from Codex, Claude Code and VS Code.
function toolbox() {
  const disabled = new Set(extensionContext.globalState.get('toolboxDisabled') || []);
  const found = discover({ projectRoots: workspaceRoots() });
  // Servers already connected directly (e.g. project Unity MCP) are not duplicated.
  const direct = new Set(configuredMcpServers().map(server => (server.url || '').replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  return { ...found, servers: found.servers.filter(server => !direct.has((server.url || '').replace(/\/+$/, '').toLowerCase())), disabled };
}
function attachToolbox(runner) {
  if (!vscode.workspace.getConfiguration('poTeam').get('importToolbox', true)) return;
  try {
    const found = toolbox();
    runner.skills = found.disabled.has('skills') ? [] : found.skills;
    runner.hub = new McpHub(found.servers.filter(server => !found.disabled.has(server.id)), id => extensionContext.secrets.get('mcp:' + id));
  } catch (error) { output.appendLine('Toolbox import failed: ' + error.message); }
}
async function manageToolbox() {
  const found = toolbox();
  const items = [
    { label: 'Skills (' + found.skills.length + ')', description: [...new Set(found.skills.map(skill => skill.source))].join(', '), id: 'skills', picked: !found.disabled.has('skills') },
    ...found.servers.map(server => ({ label: 'MCP ' + server.id, description: server.source + ' · ' + server.type + (server.url ? ' · ' + new URL(server.url).host : ' · ' + server.command), id: server.id, picked: !found.disabled.has(server.id) }))
  ];
  const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Toolbox từ Codex / Claude / VS Code — bỏ chọn để tắt', ignoreFocusOut: true });
  if (!chosen) return;
  const on = new Set(chosen.map(item => item.id));
  await extensionContext.globalState.update('toolboxDisabled', items.filter(item => !on.has(item.id)).map(item => item.id));
  const skipped = found.skipped.map(item => '- ' + item.source + '/' + item.name + ': ' + item.reason).join('\n');
  output.appendLine('Toolbox: ' + on.size + '/' + items.length + ' bật.' + (skipped ? '\nBỏ qua:\n' + skipped : ''));
  const action = await vscode.window.showInformationMessage('Toolbox: bật ' + on.size + '/' + items.length + '. Áp dụng cho lượt chạy tiếp theo.', 'Kiểm tra MCP');
  if (action === 'Kiểm tra MCP') {
    const hub = new McpHub(found.servers.filter(server => on.has(server.id)), id => extensionContext.secrets.get('mcp:' + id));
    const lines = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Đang kiểm tra MCP…' }, async () => {
      for (const server of hub.servers) {
        try { const tools = JSON.parse(await hub.call('mcp_list_tools', { server: server.id })).tools; lines.push('✔ ' + server.id + ' — ' + tools.length + ' tools'); }
        catch (error) { lines.push('✖ ' + server.id + ' — ' + error.message); }
      }
      await hub.close();
    });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Toolbox MCP\n\n' + lines.join('\n') + (skipped ? '\n\n## Bỏ qua\n' + skipped : '') }), { preview: true });
  }
}

let store;
let panel = null;
let panelRun = null;
let statusItem;
let output;
let extensionContext;
let renderState = {};
const running = new Map();
const completed = new Map();
const previews = new Map();
const pending = new Map();
const modelChanges = new Map();
let emptyProjectId;
let detailSerial = 0;

function connectionInfo() {
  const profile = extensionContext.globalState.get('proxyProfile') || {};
  return { base: profile.base || '', models: profile.models || [], roles: profile.roles || {}, coordinator: profile.coordinator || profile.roles?.opus || '', connected: !!profile.base, scannedAt: profile.scannedAt };
}

function postConnection() {
  panel?.webview.postMessage({ type: 'connection', ...connectionInfo(), running: [...running.keys()], project: projectInfo() });
  postPlan();
}

function postPlan() {
  const runner = pending.get(panelRun) || running.get(panelRun);
  panel?.webview.postMessage({ type: 'draftPlan', runId: panelRun, plan: runner?.plan || null, request: runner?.request, coordinator: runner?.roles.lead, modelSwitches: runner?.modelSwitches.snapshot(), phase: runner?.phase, editable: ['ready', 'running'].includes(runner?.phase) });
  scheduleRunDetails();
}

// Event batches arrive every ~700ms; coalesce them so details are rebuilt at most ~3 times per second.
let detailTimer = null;
function scheduleRunDetails() {
  if (detailTimer) return;
  detailTimer = setTimeout(() => { detailTimer = null; void postRunDetails(); }, 300);
}
const fileCache = new Map();
async function readCached(file, parse) {
  const stat = await fs.promises.stat(file);
  const hit = fileCache.get(file);
  if (!hit || hit.mtime !== stat.mtimeMs || hit.size !== stat.size) {
    const text = await fs.promises.readFile(file, 'utf8');
    fileCache.delete(file);
    fileCache.set(file, { mtime: stat.mtimeMs, size: stat.size, value: parse ? JSON.parse(text) : text });
    if (fileCache.size > 8) fileCache.delete(fileCache.keys().next().value);
  }
  const value = fileCache.get(file).value;
  return parse ? structuredClone(value) : value;
}

function projectInfo() {
  return { name: vscode.workspace.name || 'Chưa mở project', roots: workspaceRoots(), trusted: vscode.workspace.isTrusted };
}
function sameRoot(left, right) {
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
function hasWorkspaceRoot(root) { return workspaceRoots().some(candidate => sameRoot(candidate, root)); }

async function postRunDetails() {
  const id = panelRun, serial = ++detailSerial, selectedPanel = panel;
  if (!selectedPanel) return;
  selectedPanel.webview.options = { ...selectedPanel.webview.options, enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionContext.extensionUri, 'media'), vscode.Uri.file(eventsDir())] };
  const runner = pending.get(id) || running.get(id);
  let data = runner ? { request: runner.request, root: runner.root, phase: runner.phase, coordinator: runner.roles.lead, modelSwitches: runner.modelSwitches.snapshot(), plan: runner.plan, results: runner.results, status: Object.fromEntries(runner.taskStatus), stoppedAgents: [...runner.stoppedAgents], toolHistory: runner.toolHistory || [], collaboration: runner.control.snapshot(), usage: runner.usage.snapshot(), reportOutdated: runner.reportOutdated, appliedPaths: runner.appliedPaths, holdReason: runner.holdReason, delivery: runner.delivery, concept: runner.concept, schedule: runner.schedule, ...runner.finalOutcome } : null;
  let report = completed.get(id)?.report || '';
  if (id && store.get(id)) {
    if (!data) { try { data = await readCached(path.join(eventsDir(), id + '.state.json'), true); } catch {} }
    if (!report) { try { report = await readCached(path.join(eventsDir(), id + '.md'), false); } catch {} }
  }
  if (runner || data?.reportOutdated) report = '';
  if (data?.plan) data.delivery = deliveryReport({ ...data, summary: data.reportOutdated ? '' : data.delivery?.summary || data.reviews?.at(-1)?.summary });
  if (data?.plan && !data.schedule) data.schedule = { ...forecast(data.plan, data.status), rules: RULES, provisional: true };
  const imagePreviews = [];
  for (const option of data?.concept?.options || []) if (option.preview?.artifact) {
    try { option.preview = { ...option.preview, previewUrl: selectedPanel.webview.asWebviewUri(vscode.Uri.file(await imageArtifact(eventsDir(), id, option.preview.artifact))).toString() }; } catch {}
  }
  for (const result of Object.values(data?.results || {})) for (const item of result.images || []) {
    try {
      const file = await imageArtifact(eventsDir(), id, item.artifact);
      imagePreviews.push({ ...item, previewUrl: selectedPanel.webview.asWebviewUri(vscode.Uri.file(file)).toString() });
    } catch {}
  }
  for (const item of data?.collaboration?.messages || []) for (const attachment of item.attachments || []) if (attachment.type === 'image' && /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(attachment.file || '')) attachment.previewUrl = selectedPanel.webview.asWebviewUri(vscode.Uri.file(path.join(eventsDir(), id + '.attachments', attachment.file))).toString();
  const composerDraft = (extensionContext.workspaceState.get('sessionDrafts') || {})[id] || '';
  const external = externalOwner(data, runner, await stateTouched(id));
  if (external) {
    // Show CEO messages that are waiting in the inbox so they never look lost.
    try {
      const waiting = (await fs.promises.readFile(path.join(eventsDir(), id + '.inbox.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line, index) => { const item = JSON.parse(line); return { id: 'inbox-' + index, role: 'user', text: item.text || '(đính kèm)', attachments: item.attachments || [], createdAt: item.at || new Date().toISOString(), status: 'queued' }; });
      if (waiting.length) data = { ...data, collaboration: { ...(data.collaboration || {}), messages: [...(data.collaboration?.messages || []), ...waiting] } };
    } catch {}
  }
  const canResume = !runner && !external && !!data?.request && (data.approved === false || ['paused', 'pausing', 'running', 'planning', 'reviewing', 'concept_planning'].includes(data.phase) || !!data.error || Object.values(data.status || {}).some(status => ['failed', 'blocked', 'paused', 'stopped'].includes(status)));
  if (serial === detailSerial && id === panelRun && panel === selectedPanel) selectedPanel.webview.postMessage({ type: 'runDetails', runId: id, data, report, images: imagePreviews, composerDraft, live: !!runner || external, canResume, canPause: !!runner && ['concept_planning', 'planning', 'awaiting_concept', 'ready', 'running', 'reviewing'].includes(runner.phase), canApply: !!completed.get(id)?.proposals.length });
}

async function newSession() {
  const id = 'team-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  const directory = eventsDir();
  const title = 'Session ' + (store.list().length + 1);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(path.join(directory, id + '.state.json'), JSON.stringify({ run: id, phase: 'new', sessionTitle: title, results: {} }));
  await fs.promises.writeFile(path.join(directory, id + '.jsonl'), JSON.stringify({ ts: new Date().toISOString(), run: id, agent: 'lead', type: 'session', title }) + '\n');
  await store.poll();
  openPanel(extensionContext, id);
  postConnection();
  return id;
}

async function renameSession() {
  const id = panelRun, session = store.get(id);
  if (!session) return;
  const directory = eventsDir();
  const title = await vscode.window.showInputBox({ title: 'Đổi tên session', value: session.state.title, ignoreFocusOut: true });
  if (!title?.trim()) return;
  if (directory !== eventsDir()) throw new Error('Project đã đổi. Chọn lại session cần đổi tên.');
  const runner = pending.get(id) || running.get(id);
  if (runner) { runner.sessionTitle = title.trim().slice(0, 100); await runner.saveState(); }
  else {
    const file = path.join(eventsDir(), id + '.state.json');
    let data = {}; try { data = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch {}
    await fs.promises.writeFile(file, JSON.stringify({ ...data, sessionTitle: title.trim().slice(0, 100) }));
  }
  await fs.promises.appendFile(path.join(eventsDir(), id + '.jsonl'), JSON.stringify({ ts: new Date().toISOString(), run: id, agent: 'lead', type: 'session', title: title.trim().slice(0, 100) }) + '\n');
  await store.poll(); postSnapshot(id);
}

async function restoreDrafts() {
  const profile = connectionInfo(), key = await extensionContext.secrets.get('proxyKey');
  if (!key || !profile.base) return;
  for (const run of store.list()) {
    if (pending.has(run.id) || running.has(run.id)) continue;
    let data;
    try { data = JSON.parse(await fs.promises.readFile(path.join(eventsDir(), run.id + '.state.json'), 'utf8')); } catch { continue; }
    if (data.base && normalizeBase(data.base) !== normalizeBase(profile.base)) continue;
    if (data.root && !hasWorkspaceRoot(data.root)) continue;
    try {
      // Old requests no longer exist after a host reload. Honor the saved choice
      // immediately, retaining the first click's deadline and the complete outcome.
      for (const [agent, request] of Object.entries(data.modelSwitches?.pending || {})) {
        const event = changeSavedModel(data, agent, request.model, profile.models);
        if (!event) continue;
        const target = path.join(eventsDir(), run.id + '.state.json');
        await fs.promises.writeFile(target + '.tmp', JSON.stringify(data), 'utf8');
        await fs.promises.rename(target + '.tmp', target);
        await fs.promises.appendFile(path.join(eventsDir(), run.id + '.jsonl'), JSON.stringify(event) + '\n');
      }
      if (!['ready', 'awaiting_concept'].includes(data.phase) || run.ended) continue;
      const plan = data.plan ? validatePlan(managedPlan(data.plan, profile.models, data.coordinator, data.managed !== true), profile.models) : undefined;
      const runner = new TeamRunner(new ProxyClient(profile.base, key), { lead: data.coordinator, leadership: data.leadership, modelSwitches: data.modelSwitches }, eventsDir(), data.root);
      runner.run = run.id; runner.sessionTitle = data.sessionTitle; runner.request = data.request; runner.plan = plan; runner.models = profile.models; runner.phase = data.phase;
      runner.managed = true;
      runner.results = data.results || {}; runner.taskStatus = new Map(Object.entries(data.status || {}));
      runner.reviewRound = data.reviewRound || 0; runner.reviews = data.reviews || []; runner.feedback = data.feedback || {}; runner.history = data.history || [];
      runner.toolHistory = data.toolHistory || []; runner.manualModels = data.manualModels || {}; runner.restoreSession(data);
      runner.resume = runner.taskStatus.size > 0;
      runner.stoppedAgents = new Set((data.stoppedAgents || []).filter(id => plan?.roles.some(role => role.id === id)));
      for (const role of plan?.roles || []) runner.roles[role.id] = role.model;
      pending.set(run.id, runner);
      await runner.modelSwitches.restore();
    } catch {}
  }
}

async function connectProxy() {
  const current = connectionInfo();
  const base = await vscode.window.showInputBox({ title: 'PO Team · Proxy', prompt: 'Base URL OpenAI-compatible, ví dụ https://llmproxy.inwave.vn/v1', value: current.base,
    ignoreFocusOut: true, validateInput: value => { try { normalizeBase(value); return null; } catch (error) { return error.message; } } });
  if (!base) return;
  const oldKey = current.base === normalizeBase(base) ? await extensionContext.secrets.get('proxyKey') : null;
  const key = await vscode.window.showInputBox({ title: 'PO Team · API key', prompt: oldKey ? 'Để trống để giữ API key hiện tại' : 'Nhập API key của proxy', password: true, ignoreFocusOut: true });
  if (key === undefined || (!key.trim() && !oldKey)) return;
  const actualKey = key.trim() || oldKey;
  const found = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PO Team: quét model từ proxy…' }, () => new ProxyClient(base, actualKey).models());
  const roles = {};
  const preferred = { opus: /claude-opus-5-5/, sonnet: /claude-sonnet-5-5/, sol: /gpt-6\.1-sol/ };
  for (const agent of R.AGENTS) roles[agent] = found.models.find(model => model.id === current.roles[agent])?.id || found.models.find(model => preferred[agent].test(model.id))?.id || found.models[0].id;
  await extensionContext.secrets.store('proxyKey', actualKey);
  const coordinator = found.models.some(model => model.id === current.coordinator) ? current.coordinator : roles.opus;
  await extensionContext.globalState.update('proxyProfile', { base: found.base, models: found.models, roles, coordinator, scannedAt: Date.now() });
  postConnection();
  vscode.window.showInformationMessage('PO Team: tìm thấy ' + found.models.length + ' model.');
}

async function scanModels() {
  const profile = connectionInfo();
  const key = await extensionContext.secrets.get('proxyKey');
  if (!profile.base || !key) return connectProxy();
  const found = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PO Team: làm mới danh sách model…' }, () => new ProxyClient(profile.base, key).models());
  const roles = { ...profile.roles };
  for (const agent of R.AGENTS) if (!found.models.some(model => model.id === roles[agent])) roles[agent] = found.models[0].id;
  const coordinator = found.models.some(model => model.id === profile.coordinator) ? profile.coordinator : found.models[0].id;
  await extensionContext.globalState.update('proxyProfile', { base: found.base, models: found.models, roles, coordinator, scannedAt: Date.now() });
  postConnection();
}

async function startTeam(input = {}) {
  let session;
  if (input.sessionId) {
    if (!store.get(input.sessionId)) throw new Error('Session không thuộc project đang mở.');
    try { session = JSON.parse(await fs.promises.readFile(path.join(eventsDir(), input.sessionId + '.state.json'), 'utf8')); } catch {}
    if (session?.phase !== 'new' || running.has(input.sessionId) || pending.has(input.sessionId)) throw new Error('Session đã có kế hoạch. Giao thêm task hoặc tạo session mới.');
  }
  const profile = connectionInfo();
  const key = await extensionContext.secrets.get('proxyKey');
  if (!profile.base || !key) { await connectProxy(); if (connectionInfo().base && await extensionContext.secrets.get('proxyKey')) return startTeam(input); return; }
  const task = typeof input.task === 'string' && input.task.trim() ? input.task : await vscode.window.showInputBox({ title: 'Phân tích & lên plan', prompt: 'Model điều phối phân tích project, đề xuất vị trí và chia việc. Bạn chọn model trước khi thực hiện.', ignoreFocusOut: true });
  if (!task?.trim()) return;
  const choices = [];
  if (vscode.workspace.isTrusted) for (const folder of vscode.workspace.workspaceFolders || []) choices.push({ label: 'Cho phép đọc source: ' + folder.name, description: 'Source được chọn bởi model sẽ gửi tới ' + profile.base, root: folder.uri.fsPath });
  choices.push({ label: 'Chỉ gửi yêu cầu', description: 'Không đọc file workspace', root: null });
  let access;
  if (input.readWorkspace === false) access = choices.at(-1);
  else if (input.readWorkspace === true && choices.length === 2) access = choices[0];
  else if (choices.length === 1) access = choices[0];
  else access = await vscode.window.showQuickPick(choices, { title: 'Dữ liệu gửi tới proxy', placeHolder: 'Chọn project đang mở cho lượt chạy này', ignoreFocusOut: true });
  if (!access) return;
  if (session && (running.has(input.sessionId) || pending.has(input.sessionId))) throw new Error('Session này đã bắt đầu lập kế hoạch.');
  const runner = new TeamRunner(new ProxyClient(profile.base, key), { lead: profile.coordinator, managed: true }, eventsDir(), access.root);
  if (session) { runner.run = input.sessionId; runner.sessionTitle = session.sessionTitle; }
  running.set(runner.run, runner);
  const drafts = { ...(extensionContext.workspaceState.get('sessionDrafts') || {}) }; delete drafts[runner.run];
  await extensionContext.workspaceState.update('sessionDrafts', drafts);
  openPanel(extensionContext, runner.run); postConnection();
  try {
    await attachMcp(runner);
    await runner.propose(task.trim(), profile.models);
    if (runner.phase === 'awaiting_concept') pending.set(runner.run, runner);
  } finally {
    if (['ready', 'awaiting_concept'].includes(runner.phase)) {
      try { await runner.checkpoint(); }
      catch (error) { if (error.code === 'SESSION_HOLD') { await runner.fail(error); pending.delete(runner.run); } else output.appendLine(error.message); }
    }
    await runner.mcp?.close(); running.delete(runner.run); await store.poll(); postConnection();
  }
}

async function addWork(input = {}) {
  const id = input.runId || panelRun, runner = pending.get(id) || running.get(id);
  if (!runner?.plan || !['ready', 'running'].includes(runner.phase)) throw new Error('Chọn một plan đang chờ hoặc team đang làm để bổ sung.');
  const profile = connectionInfo();
  if (normalizeBase(profile.base) !== runner.client.base) throw new Error('Proxy đã đổi. Tạo yêu cầu mới để giao việc qua proxy hiện tại.');
  runner.models = [...new Map([...runner.models, ...profile.models].map(model => [typeof model === 'string' ? model : model.id, model])).values()];
  if (runner.root && (!vscode.workspace.isTrusted || !hasWorkspaceRoot(runner.root))) throw new Error('Project đã đổi hoặc chưa trusted. Hãy tạo yêu cầu mới.');
  const choices = runner.plan.roles.filter(role => !runner.stoppedAgents.has(role.id)).map(role => ({ label: role.name, description: role.model, role }));
  choices.push({ label: '+ Thêm vị trí mới', description: 'Chọn model và giao việc đầu tiên', newRole: true });
  const pick = input.newRole ? choices.at(-1) : await vscode.window.showQuickPick(choices, { title: 'Giao thêm việc cho vị trí', ignoreFocusOut: true });
  if (!pick) return;
  const uid = () => 'u' + crypto.randomBytes(6).toString('hex');
  let role = null;
  if (pick.newRole) {
    const name = await vscode.window.showInputBox({ title: 'Tên vị trí mới', placeHolder: 'Ví dụ: QA, Backend, Game Logic', ignoreFocusOut: true });
    if (!name?.trim()) return;
    const responsibility = await vscode.window.showInputBox({ title: 'Trách nhiệm của ' + name, ignoreFocusOut: true });
    if (!responsibility?.trim()) return;
    const selected = await vscode.window.showQuickPick(profile.models.map(model => ({ label: model.id })), { title: 'Model cho ' + name, ignoreFocusOut: true });
    if (!selected) return;
    role = { id: uid(), name: name.trim(), responsibility: responsibility.trim(), model: selected.label, reason: 'Bạn chọn trực tiếp' };
  }
  const title = await vscode.window.showInputBox({ title: 'Tên việc bổ sung', ignoreFocusOut: true });
  if (!title?.trim()) return;
  const instruction = await vscode.window.showInputBox({ title: 'Yêu cầu và kết quả cần nhận', prompt: 'Mô tả việc và tiêu chí hoàn thành', value: title, ignoreFocusOut: true });
  if (!instruction?.trim()) return;
  const scope = runner.root ? await vscode.window.showInputBox({ title: 'Phạm vi file / thư mục', prompt: 'Ngăn cách bằng dấu phẩy. Để trống nếu chỉ phân tích.', ignoreFocusOut: true }) : '';
  if (scope === undefined) return;
  const dependencies = await vscode.window.showQuickPick(runner.plan.tasks.map(task => ({ label: task.title, description: task.id, id: task.id })), { title: 'Việc cần hoàn thành trước (có thể để trống)', canPickMany: true, ignoreFocusOut: true });
  if (!dependencies) return;
  const task = { id: uid(), roleId: role?.id || pick.role.id, title: title.trim(), instruction: instruction.trim(), scope: scope.split(',').map(item => item.trim()).filter(Boolean), dependsOn: dependencies.map(item => item.id) };
  await runner.addWork(role, task); await store.poll(); postPlan();
}

async function conceptAction(message) {
  const id = message.runId, runner = pending.get(id), directory = eventsDir();
  await sessionControls.get(id);
  if (id !== panelRun || !runner || runner.phase !== 'awaiting_concept' || running.has(id)) throw new Error('Chọn đề xuất đang chờ duyệt trong project này.');
  const profile = connectionInfo(), key = await extensionContext.secrets.get('proxyKey');
  if (!key || normalizeBase(profile.base) !== runner.client.base || (runner.root && (!hasWorkspaceRoot(runner.root) || !vscode.workspace.isTrusted))) throw new Error('Kiểm tra lại project và kết nối của session.');
  if (!runner.concept.options.some(option => option.id === message.optionId)) throw new Error('Hướng làm không tồn tại.');
  runner.client = new ProxyClient(profile.base, key); runner.models = profile.models;
  let imageModel = message.model;
  if (message.type === 'conceptPreview' && !imageModel) imageModel = (await vscode.window.showQuickPick(profile.models.filter(item => isImageModel(item.id)).map(item => ({ label: item.id })), { title: 'Chọn model tạo ảnh demo cho hướng này' }))?.label;
  if (message.type === 'conceptPreview' && !imageModel) return;
  if (directory !== eventsDir() || panelRun !== id || running.has(id)) throw new Error('Project hoặc session đã đổi.');
  running.set(id, runner); pending.delete(id); postPlan();
  try {
    if (message.type === 'conceptPreview') await runner.previewConcept(message.optionId, imageModel);
    else {
      await attachMcp(runner); await runner.approveConcept(message.optionId);
      if (runner.phase === 'ready') {
        const choices = (extensionContext.workspaceState.get('teamAssignments') || {})[runner.root || '__prompt'] || {};
        for (const role of runner.plan.roles) if (profile.models.some(model => model.id === choices[role.id])) role.model = choices[role.id];
        await runner.publishTeam();
      }
    }
  } finally {
    if (!runner.abort.signal.aborted) {
      try { await runner.checkpoint(); } catch (error) { if (error.code === 'SESSION_HOLD') await runner.fail(error); else output.appendLine(error.message); }
    }
    await runner.mcp?.close(); running.delete(id);
    if (['awaiting_concept', 'ready'].includes(runner.phase)) pending.set(id, runner);
    await store.poll(); postPlan(); postConnection();
  }
}

async function stopAgent(input = {}) {
  const runner = running.get(input.runId) || pending.get(input.runId);
  if (!runner || typeof input.agent !== 'string') throw new Error('Vị trí này không còn chạy.');
  if (input.agent === 'lead' && pending.has(input.runId)) {
    runner.cancel(); runner.phase = 'ended'; pending.delete(input.runId);
    await runner.event('lead', 'end', { text: 'Bạn đã dừng điều phối và hủy plan.' });
    await runner.saveState(); await store.poll(); postConnection(); return;
  }
  await runner.stopAgent(input.agent); await store.poll(); postPlan();
}

async function changeModel(input = {}) {
  const id = input.runId || panelRun, directory = eventsDir();
  if (!id || !store.get(id) || id !== panelRun) throw new Error('Chọn session thuộc project đang mở trước khi đổi model.');
  const previous = modelChanges.get(id) || Promise.resolve();
  const action = previous.catch(() => {}).then(async () => {
    const profile = connectionInfo();
    if (typeof input.agent !== 'string' || typeof input.model !== 'string') throw new Error('Chọn vị trí và model cần đổi.');
    const runner = pending.get(id) || running.get(id);
    if (runner) {
      if (directory !== eventsDir() || runner.root && !hasWorkspaceRoot(runner.root)) throw new Error('Project đã đổi.');
      if (normalizeBase(profile.base) !== runner.client.base) throw new Error('Proxy của session khác proxy đang kết nối.');
      runner.models = profile.models;
      return runner.modelSwitches.request(input.agent, input.model, input.requestedAt);
    }
    const target = path.join(directory, id + '.state.json');
    const data = JSON.parse(await fs.promises.readFile(target, 'utf8'));
    if (directory !== eventsDir() || panelRun !== id || data.root && !hasWorkspaceRoot(data.root)) throw new Error('Project hoặc session đã đổi.');
    if (running.has(id) || pending.has(id)) throw new Error('Session vừa bắt đầu. Chọn đổi lại trên trạng thái mới.');
    if (data.base && normalizeBase(data.base) !== normalizeBase(profile.base)) throw new Error('Proxy của session khác proxy đang kết nối.');
    const event = changeSavedModel(data, input.agent, input.model, profile.models);
    if (!event) return { state: 'unchanged' };
    // Preserve the complete saved outcome, including approval, report and staged assets.
    await fs.promises.writeFile(target + '.tmp', JSON.stringify(data), 'utf8');
    await fs.promises.rename(target + '.tmp', target);
    await fs.promises.appendFile(path.join(directory, id + '.jsonl'), JSON.stringify(event) + '\n');
    return { state: 'applied' };
  });
  modelChanges.set(id, action);
  try { return await action; }
  finally {
    if (modelChanges.get(id) === action) modelChanges.delete(id);
    await store.poll(); postPlan();
  }
}

async function openReport() {
  if (!panelRun || !store.get(panelRun)) return;
  try {
    const data = JSON.parse(await fs.promises.readFile(path.join(eventsDir(), panelRun + '.state.json'), 'utf8'));
    if (data.reportOutdated) return vscode.window.showInformationMessage('Báo cáo cũ chưa phản ánh yêu cầu mới. Tiếp tục session để PO cập nhật; xem kết quả hiện tại trong tab Kết quả.');
  } catch {}
  const file = path.join(eventsDir(), panelRun + '.md');
  if (!fs.existsSync(file)) return vscode.window.showInformationMessage('Báo cáo tổng hợp sẽ có sau bước review. Kết quả từng vị trí có trong tab Kết quả.');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)), { viewColumn: vscode.ViewColumn.One, preview: true });
}

async function executePlan(input) {
  const id = input?.runId || panelRun, runner = pending.get(id);
  await sessionControls.get(id);
  await modelChanges.get(id);
  if (!runner || runner.phase !== 'ready') throw new Error('Không có plan đang chờ trong lượt này.');
  if (runner.root && (!vscode.workspace.isTrusted || !hasWorkspaceRoot(runner.root))) throw new Error('Workspace không còn được cấp quyền. Hãy lập plan lại.');
  const assignments = input?.assignments || {};
  const profile = connectionInfo();
  if (normalizeBase(profile.base) !== runner.client.base) throw new Error('Proxy đã đổi sau khi lập plan. Hãy lập plan mới cho proxy hiện tại.');
  if (!profile.models.some(model => model.id === runner.roles.lead)) throw new Error('Model điều phối không còn trong catalog. Hãy lập plan mới.');
  for (const role of runner.plan.roles) {
    const model = assignments[role.id] || role.model;
    if (!profile.models.some(item => item.id === model)) throw new Error('Model không còn trong danh sách proxy: ' + model);
  }
  const key = await extensionContext.secrets.get('proxyKey');
  if (!key) throw new Error('Kết nối proxy lại trước khi thực hiện.');
  if (running.has(id)) return;
  runner.client = new ProxyClient(profile.base, key);
  runner.models = profile.models;
  running.set(id, runner); pending.delete(id); postConnection();
  try {
    await attachMcp(runner);
    const result = await runner.executePlan(assignments, runner.resume === true);
    if (!result) return;
    const saved = extensionContext.workspaceState.get('teamAssignments') || {};
    saved[runner.root || '__prompt'] = Object.fromEntries(runner.plan.roles.map(role => [role.id, role.model]));
    await extensionContext.workspaceState.update('teamAssignments', saved);
    result.originals = new Map();
    for (const file of result.root ? result.proposals : []) {
      const target = await proposalTarget(result.root, file.path);
      let original = null;
      try { original = await fs.promises.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      result.originals.set(file.path, original);
    }
    completed.set(runner.run, result);
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: result.report });
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: true });
  } catch (error) {
    if (runner.pauseRequested) { await runner.fail(error); return; }
    if (runner.phase !== 'ended') await runner.fail(error);
    throw error;
  } finally {
    // Messages arriving during final report persistence are still handled in this session.
    if (!runner.abort.signal.aborted) {
      try { await runner.checkpoint(); }
      catch (error) { if (error.code === 'SESSION_HOLD') await runner.fail(error); else output.appendLine(error.message); }
    }
    if (runner.reportOutdated || runner.phase !== 'ended') completed.delete(id);
    await runner.mcp?.close(); running.delete(id); await store.poll(); postConnection();
  }
}

// A session can be driven by another process (second VS Code window / CLI). Its heartbeat in state.json proves it is alive.
function externalOwner(data, runner, touched = 0) {
  // Older runners do not write owner/heartbeat; a state file written in the last 3 minutes still means another process is working on it.
  if (runner || !data || !['planning', 'running', 'reviewing', 'pausing', 'concept_planning'].includes(data.phase)) return false;
  if (data.owner === process.pid) return false;
  return Date.now() - Math.max(data.heartbeat || 0, touched || 0) < 180000;
}
async function stateTouched(id) {
  try { return (await fs.promises.stat(path.join(eventsDir(), id + '.state.json'))).mtimeMs; } catch { return 0; }
}
async function sessionControl(message) {
  const id = message.runId, directory = eventsDir();
  if (id !== panelRun || !store.get(id) || !['chatPO', 'retryPO', 'answerDecision', 'sessionBudget'].includes(message.type)) throw new Error('Chọn session thuộc project hiện tại.');
  const previous = sessionControls.get(id) || Promise.resolve();
  const action = previous.catch(() => {}).then(async () => {
    const profile = connectionInfo(), key = await extensionContext.secrets.get('proxyKey');
    let runner = running.get(id) || pending.get(id);
    if (!runner) {
      const data = JSON.parse(await fs.promises.readFile(path.join(directory, id + '.state.json'), 'utf8'));
      if (externalOwner(data, runner, await stateTouched(id))) {
        if (message.type !== 'chatPO') throw new Error('Session đang chạy ở tiến trình khác; thao tác này sẽ khả dụng khi lượt chạy kết thúc.');
        // Hand the message to the live runner instead of starting a second PO on the same session.
        await fs.promises.appendFile(path.join(directory, id + '.inbox.jsonl'), JSON.stringify({ text: message.text || '', attachments: await saveAttachments(directory, id, message.attachments || {}, workspaceRoots()), at: new Date().toISOString() }) + '\n');
        return;
      }
      if (!data.request || !key) throw new Error('Giao mục tiêu và kết nối proxy trước khi chat với PO.');
      if (data.base && normalizeBase(data.base) !== normalizeBase(profile.base)) throw new Error('Proxy đã đổi. Chọn lại proxy của session.');
      runner = new TeamRunner(new ProxyClient(profile.base, key), { lead: data.coordinator, managed: data.managed, leadership: data.leadership, modelSwitches: data.modelSwitches }, directory, data.root);
      Object.assign(runner, { run: id, request: data.request, sessionTitle: data.sessionTitle, plan: data.plan ? validatePlan(data.plan, profile.models) : undefined, models: profile.models, phase: data.phase, results: data.results || {}, taskStatus: new Map(Object.entries(data.status || {})), stoppedAgents: new Set(data.stoppedAgents || []), reviewRound: data.reviewRound || 0, reviews: data.reviews || [], feedback: data.feedback || {}, history: data.history || [], toolHistory: data.toolHistory || [], manualModels: data.manualModels || {} });
      runner.restoreSession(data);
      for (const role of runner.plan?.roles || []) runner.roles[role.id] = role.model;
    }
    if (id !== panelRun || directory !== eventsDir() || (runner.root && (!hasWorkspaceRoot(runner.root) || !vscode.workspace.isTrusted))) throw new Error('Project hoặc session đã đổi, hoặc chưa được trusted.');
    if (!key || normalizeBase(profile.base) !== runner.client.base || !profile.models.some(model => model.id === runner.roles.lead)) throw new Error('Kiểm tra kết nối và model PO của session.');
    if (message.type === 'sessionBudget') {
      if (!message.settings || JSON.stringify(message.settings).length > 60000) throw new Error('Cấu hình ngân sách không hợp lệ.');
      for (const model of Object.keys(message.settings.prices || {})) if (!profile.models.some(item => item.id === model)) throw new Error('Bảng giá cần đúng ID model trong proxy: ' + model);
      runner.usage.configure(message.settings);
      // A budget-denied task has already left the active batch. Complete the pause
      // before resuming it; clearing this mid-batch could silently skip that task.
      if (!running.has(id)) runner.holdReason = '';
      await runner.saveState();
    } else {
      let quick = null;
      if (message.type === 'chatPO') quick = await runner.control.enqueue(message.text || '', await saveAttachments(directory, id, message.attachments || {}, workspaceRoots()));
      else if (message.type === 'retryPO') { await runner.control.retry(message.messageId); quick = { id: message.messageId }; }
      else await runner.control.answer(message.decisionId, message.choice, message.custom === true);
      // The team is busy: PO answers right away from live state without touching running work.
      if (quick && running.has(id)) {
        void runner.control.quickReply(quick.id, parseObject).then(async () => { await store.poll(); postPlan(); }).catch(error => output.appendLine('PO trả lời nhanh: ' + error.message));
      }
      // Running/planning/reviewing PO jobs own their scheduler boundary. Never launch a second PO request here.
      if (!running.has(id) && (runner.plan || runner.concept && !runner.concept.approved)) {
        running.set(id, runner); pending.delete(id);
        try { await runner.checkpoint(); }
        catch (error) { if (error.code === 'SESSION_HOLD') await runner.fail(error); else throw error; }
        finally { await runner.mcp?.close(); running.delete(id); if (['awaiting_concept', 'ready'].includes(runner.phase)) pending.set(id, runner); }
        if (runner.phase === 'paused') pending.delete(id);
        if (runner.reportOutdated) { runner.resume = true; completed.delete(id); }
      }
    }
    await store.poll(); postPlan();
  });
  sessionControls.set(id, action);
  try { await action; }
  finally { if (sessionControls.get(id) === action) sessionControls.delete(id); }
}

async function proposalTarget(root, relative) {
  if (!root) throw new Error('Lượt chạy này chưa được cấp workspace.');
  const safe = safeRelative(relative);
  if (!safe) throw new Error('Đường dẫn file rỗng.');
  const target = path.resolve(root, safe);
  const actualRoot = await fs.promises.realpath(root);
  let parent = target;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const actualParent = await fs.promises.realpath(parent);
  if (actualParent !== actualRoot && !actualParent.startsWith(actualRoot + path.sep)) throw new Error('Không áp dụng qua symlink ngoài workspace.');
  return target;
}

async function selectedImage(message) {
  const id = panelRun, directory = eventsDir();
  if (!id || message.runId !== id || !store.get(id)) throw new Error('Chọn lại session chứa ảnh.');
  const runner = running.get(id) || pending.get(id);
  const data = runner || JSON.parse(await fs.promises.readFile(path.join(directory, id + '.state.json'), 'utf8'));
  if (id !== panelRun || directory !== eventsDir() || (data.root && !hasWorkspaceRoot(data.root))) throw new Error('Project hoặc session đã đổi.');
  const item = [...Object.values(data.results || {}).flatMap(result => result.images || []), ...(data.concept?.options || []).flatMap(option => option.preview?.artifact ? [{...option.preview, path:'generated/concepts/' + option.id + '.png'}] : [])].find(image => image.artifact === message.artifact);
  if (!item) throw new Error('Không có ảnh này trong session.');
  return { item, root: data.root, id, directory, source: await imageArtifact(directory, id, item.artifact) };
}

async function openImage(message) {
  const image = await selectedImage(message);
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(image.source), { preview: true, viewColumn: vscode.ViewColumn.One });
}

async function saveImage(message) {
  const image = await selectedImage(message);
  if (!image.root || !vscode.workspace.isTrusted) throw new Error('Mở project trusted để lưu ảnh.');
  const defaultPath = await proposalTarget(image.root, image.item.path);
  const chosen = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath), filters: { PNG: ['png'] }, saveLabel: 'Lưu ảnh vào project' });
  if (!chosen) return;
  if (panelRun !== image.id || eventsDir() !== image.directory || !hasWorkspaceRoot(image.root)) throw new Error('Project hoặc session đã đổi.');
  const relative = safeRelative(path.relative(image.root, chosen.fsPath));
  if (!/\.png$/i.test(relative)) throw new Error('Chọn file PNG bên trong project.');
  const target = await proposalTarget(image.root, relative);
  let flag = fs.constants.COPYFILE_EXCL;
  if (fs.existsSync(target)) {
    const confirmed = await vscode.window.showWarningMessage('Ghi đè ảnh ' + relative + '?', { modal: true }, 'Ghi đè');
    if (confirmed !== 'Ghi đè') return;
    flag = 0;
  }
  if (panelRun !== image.id || eventsDir() !== image.directory || !hasWorkspaceRoot(image.root) || !vscode.workspace.isTrusted) throw new Error('Project hoặc session đã đổi.');
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await proposalTarget(image.root, relative);
  await fs.promises.copyFile(image.source, target, flag);
  vscode.window.showInformationMessage('Đã lưu ảnh: ' + relative + '. Unity sẽ import khi nhận file; chưa gán sprite/material vào scene.');
}

async function generateImage(input = {}) {
  const profile = connectionInfo(), key = await extensionContext.secrets.get('proxyKey');
  if (!profile.base || !key) throw new Error('Kết nối proxy trước khi tạo ảnh.');
  const roots = workspaceRoots();
  if (!vscode.workspace.isTrusted || !roots.length) throw new Error('Mở project trusted để tạo và lưu ảnh.');
  const choices = profile.models.filter(item => isImageModel(item.id)).map(item => ({ label: item.id }));
  if (!choices.length) throw new Error('Chưa thấy model ảnh. Quét lại catalog từ proxy.');
  const selected = input.model && choices.find(item => item.label === input.model) || await vscode.window.showQuickPick(choices, { title: 'Model tạo ảnh từ proxy' });
  if (!selected) return;
  const prompt = input.prompt || await vscode.window.showInputBox({ title: 'Prompt tạo ảnh', prompt: 'Mô tả asset, phong cách và cách dùng. Ảnh sẽ lưu trong session để xem trước.', ignoreFocusOut: true });
  if (!prompt?.trim()) return;
  const size = input.size || await vscode.window.showQuickPick(['1024x1024', '1536x1024', '1024x1536'], { title: 'Kích thước ảnh: vuông / ngang / dọc' });
  if (!size) return;
  const background = input.background || await vscode.window.showQuickPick(['auto', 'transparent', 'opaque'], { title: 'Nền ảnh: tự động / trong suốt / nền kín' });
  if (!background) return;
  const root = roots.length === 1 ? roots[0] : (await vscode.window.showQuickPick(roots.map(root => ({ label: root, root })), { title: 'Project lưu ảnh' }))?.root;
  if (!root || !hasWorkspaceRoot(root)) return;
  if (isImageModel(profile.coordinator)) throw new Error('Chọn model văn bản làm điều phối để review.');
  const runner = new TeamRunner(new ProxyClient(profile.base, key), { lead: profile.coordinator }, eventsDir(), root);
  const scope = fs.existsSync(path.join(root, 'Assets')) ? 'Assets/Generated/AI' : 'generated/images';
  runner.request = prompt.trim(); runner.sessionTitle = 'Tạo ảnh · ' + runner.request.slice(0, 60); runner.models = profile.models; runner.phase = 'ready';
  runner.plan = { summary: 'Tạo ảnh PNG thật qua Images API, xem trước trong session và lưu vào project khi bạn chọn.', roles: [{ id: 'artist', name: 'Tạo ảnh', responsibility: 'Tạo asset PNG', model: selected.label }], tasks: [{ id: 'image', roleId: 'artist', title: 'Tạo ảnh theo prompt', instruction: runner.request, scope: [scope], dependsOn: [] }] };
  runner.imageRequests = { image: { images: [{ path: scope + '/image-' + Date.now().toString(36) + '.png', prompt: runner.request, size, background }] } };
  runner.roles.artist = selected.label;
  await runner.event('lead', 'start', { title: runner.sessionTitle }); await runner.publishTeam();
  pending.set(runner.run, runner); await store.poll(); openPanel(extensionContext, runner.run);
  await executePlan({ runId: runner.run, assignments: {} });
  return runner.run;
}

async function pauseTeam() {
  const id = panelRun, runner = running.get(id) || pending.get(id);
  if (!runner) throw new Error('Không có task đang chạy để tạm dừng.');
  await runner.pause();
  if (runner.phase === 'paused') pending.delete(id);
  await store.poll(); postConnection();
}

async function resumeTeam() {
  const id = panelRun;
  await sessionControls.get(id);
  await modelChanges.get(id);
  if (!id || !store.get(id) || running.has(id) || pending.has(id)) throw new Error('Chọn session đã kết thúc để chạy lại phần lỗi.');
  const directory = eventsDir(), profile = connectionInfo(), key = await extensionContext.secrets.get('proxyKey');
  const data = JSON.parse(await fs.promises.readFile(path.join(directory, id + '.state.json'), 'utf8'));
  if (!key || !data.request || !['paused', 'pausing', 'ended', 'running', 'planning', 'reviewing', 'concept_planning'].includes(data.phase)) throw new Error('Session chưa có công việc để tiếp tục.');
  if (data.base && normalizeBase(data.base) !== normalizeBase(profile.base)) throw new Error('Proxy đã đổi; tạo session mới.');
  if (panelRun !== id || directory !== eventsDir() || (data.root && !hasWorkspaceRoot(data.root))) throw new Error('Project hoặc session đã đổi.');
  if (running.has(id) || pending.has(id)) return;
  const runner = new TeamRunner(new ProxyClient(profile.base, key), { lead: data.coordinator, leadership: data.leadership, modelSwitches: data.modelSwitches }, directory, data.root);
  if (data.root && !vscode.workspace.isTrusted) throw new Error('Project cần trusted trước khi tiếp tục đọc source.');
  runner.run = id; runner.request = data.request; runner.sessionTitle = data.sessionTitle; runner.models = profile.models;
  runner.manualModels = data.manualModels || {}; runner.managed = data.managed === true;
  runner.restoreSession(data);
  if (!data.plan) {
    running.set(id, runner); completed.delete(id);
    try {
      await runner.modelSwitches.restore(); await attachMcp(runner);
      if (runner.concept && !runner.concept.approved) { runner.phase = 'awaiting_concept'; await runner.saveState(); }
      else if (runner.concept?.approved) await runner.prepare(data.request, profile.models);
      else await runner.propose(data.request, profile.models);
      if (['ready', 'awaiting_concept'].includes(runner.phase)) {
        try { await runner.checkpoint(); }
        catch (error) { if (error.code === 'SESSION_HOLD') await runner.fail(error); else throw error; }
      }
      if (['ready', 'awaiting_concept'].includes(runner.phase)) pending.set(id, runner);
    }
    finally { await runner.mcp?.close(); running.delete(id); await store.poll(); postConnection(); }
    return;
  }
  runner.plan = validatePlan(managedPlan(data.plan, profile.models, data.coordinator, data.managed !== true), profile.models);
  runner.results = data.results || {}; runner.taskStatus = new Map(Object.entries(data.status || {})); runner.stoppedAgents = new Set(data.stoppedAgents || []);
  runner.reviewRound = data.reviewRound || 0; runner.reviews = data.reviews || []; runner.feedback = data.feedback || {}; runner.history = data.history || [];
  runner.managed = true; runner.toolHistory = data.toolHistory || [];
  if (!runner.plan.tasks.some(task => runner.taskStatus.get(task.id) !== 'done' && !runner.stoppedAgents.has(task.roleId)) && data.phase === 'ended' && !data.error && data.approved !== false) throw new Error('Các task đã hoàn tất.');
  for (const role of runner.plan.roles) runner.roles[role.id] = role.model;
  runner.beginRecovery(); pending.set(id, runner); completed.delete(id);
  await runner.modelSwitches.restore();
  await runner.event('lead', 'resumed', { text: 'Tiếp tục session; giữ task đã xong, chạy lại phần dở/lỗi/bị chặn.' });
  await executePlan({ runId: id });
}

async function reviewChanges() {
  const result = completed.get(panelRun);
  if (!result?.proposals.length) return vscode.window.showInformationMessage('Chưa có đề xuất được PO duyệt trong lượt chạy đang chọn.');
  const chosen = await vscode.window.showQuickPick(result.proposals.map(file => ({ label: file.path, description: file.agent, file })), { title: 'Xem diff đề xuất' });
  if (!chosen) return;
  const proposed = vscode.Uri.from({ scheme: 'po-team-preview', path: '/' + result.run + '/' + chosen.file.path });
  previews.set(proposed.toString(), chosen.file.content);
  const target = result.root ? await proposalTarget(result.root, chosen.file.path) : null;
  let original;
  if (target && fs.existsSync(target)) original = vscode.Uri.file(target);
  else { original = vscode.Uri.from({ scheme: 'po-team-preview', path: '/' + result.run + '/__empty' }); previews.set(original.toString(), ''); }
  await vscode.commands.executeCommand('vscode.diff', original, proposed, chosen.file.path + ' · Đề xuất của team');
}

async function applyChanges() {
  const result = completed.get(panelRun);
  if (!result?.proposals.length) return vscode.window.showInformationMessage('Chưa có đề xuất được PO duyệt.');
  if (!vscode.workspace.isTrusted) throw new Error('Cần workspace trusted để áp dụng thay đổi.');
  const confirmed = await vscode.window.showWarningMessage('Áp dụng ' + result.proposals.length + ' file đề xuất vào workspace? Bạn có thể Undo trong editor.', { modal: true }, 'Áp dụng');
  if (!confirmed) return;
  const edit = new vscode.WorkspaceEdit();
  for (const file of result.proposals) {
    const target = await proposalTarget(result.root, file.path);
    const uri = vscode.Uri.file(target);
    const expected = result.originals.get(file.path);
    if (expected === null) {
      if (fs.existsSync(target)) throw new Error(file.path + ' vừa được tạo bên ngoài. Hãy chạy lại team.');
      edit.createFile(uri, { overwrite: false });
      edit.insert(uri, new vscode.Position(0, 0), file.content);
    } else {
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.getText() !== expected) throw new Error(file.path + ' đã thay đổi từ lúc nhận đề xuất. Hãy chạy lại team.');
      edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), file.content);
    }
  }
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('Không áp dụng được WorkspaceEdit.');
  for (const file of result.proposals) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(await proposalTarget(result.root, file.path)));
    await document.save();
    await fs.promises.appendFile(path.join(eventsDir(), result.run + '.jsonl'), JSON.stringify({ ts: new Date().toISOString(), run: result.run, agent: file.agent, type: 'file', taskId: file.taskId, path: file.path, text: 'Đã áp dụng với sự đồng ý của bạn' }) + '\n');
  }
  result.proposals = [];
  const stateFile = path.join(eventsDir(), result.run + '.state.json');
  const savedState = JSON.parse(await fs.promises.readFile(stateFile, 'utf8'));
  savedState.appliedPaths = [...new Set([...(savedState.appliedPaths || []), ...result.proposals.map(file => file.path)])];
  await fs.promises.writeFile(stateFile + '.tmp', JSON.stringify(savedState), 'utf8');
  await fs.promises.rename(stateFile + '.tmp', stateFile);
  await postRunDetails();
  vscode.window.showInformationMessage('Đã áp dụng thay đổi. Chưa chạy test.');
}

function eventsDir() {
  return projectDirectory(eventsBase(), workspaceRoots(), vscode.workspace.workspaceFile?.fsPath, emptyProjectId);
}

function eventsBase() {
  const configured = vscode.workspace.getConfiguration('poTeam').get('eventsDir');
  if (configured && configured.trim()) return configured.trim();
  if (process.env.INWAVE_TEAM_DIR) return process.env.INWAVE_TEAM_DIR;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'InwaveModelRouter', 'teams');
}

function workspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
}

function resolveInWorkspace(relative, selectedRoot) {
  if (!relative || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || relative.split(/[\\/]/).includes('..')) return null;
  const roots = selectedRoot ? workspaceRoots().filter(root => sameRoot(root, selectedRoot)) : workspaceRoots();
  for (const root of roots) {
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(candidate)) continue;
    const actualRoot = fs.realpathSync(root);
    const actual = fs.realpathSync(candidate);
    if (actual.startsWith(actualRoot + path.sep) && fs.statSync(actual).isFile()) return actual;
  }
  return null;
}

async function openSessionFile(message) {
  const id = panelRun, directory = eventsDir();
  const relative = message.path.replace(/\\/g, '/');
  if (!id || !store.get(id) || (message.runId && message.runId !== id)) return;
  if (!relative || relative.startsWith('/') || /^[a-z]:/i.test(relative) || relative.split('/').some(part => !part || part === '..' || part === '.') || /[\x00-\x1f]/.test(relative)) return;
  const runner = pending.get(id) || running.get(id);
  let data = runner || null;
  if (!data) {
    try { data = JSON.parse(await fs.promises.readFile(path.join(directory, id + '.state.json'), 'utf8')); } catch {}
  }
  if (id !== panelRun || directory !== eventsDir() || !store.get(id)) return;
  if (data?.root && !hasWorkspaceRoot(data.root)) return;
  const generated = Object.values(data?.results || {}).flatMap(result => result.images || []).find(image => image.path === relative);
  if (generated) {
    await openImage({ runId: id, artifact: generated.artifact }); return;
  }
  const demo = store.get(id).events.some(event => event.type === 'start' && event.title === 'Demo: thêm trang đăng nhập');
  const files = Object.values(data?.results || {}).flatMap(result => result.files || []);
  const proposal = files.reverse().find(file => typeof file.path === 'string' && file.path.replace(/\\/g, '/') === relative && typeof file.content === 'string');
  const target = demo ? null : resolveInWorkspace(relative, data?.root);
  if (target && (!proposal || fs.readFileSync(target, 'utf8') === proposal.content)) {
    await vscode.window.showTextDocument(vscode.Uri.file(target), { viewColumn: vscode.ViewColumn.One, preview: true });
    return;
  }
  if (proposal || demo) {
    const uri = vscode.Uri.from({ scheme: 'po-team-preview', authority: id, path: '/' + (demo ? 'demo/' + relative + '.md' : 'proposals/' + relative), query: crypto.randomBytes(6).toString('hex') });
    previews.set(uri.toString(), demo
      ? '# Đường dẫn mô phỏng: ' + relative + '\n\nSession này là demo giao việc, không gọi model và không tạo code. Vì vậy chưa có nội dung code cho file này.\n\nTạo session mới, nhập yêu cầu rồi chạy team để nhận code thật trong mục Kết quả.\n'
      : proposal.content);
    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: true });
    vscode.window.setStatusBarMessage(demo ? 'PO Team: Đường dẫn demo, chưa có code thật.' : 'PO Team: Bản đề xuất, chưa áp dụng vào project. Dùng Xem thay đổi / Áp dụng để ghi file.', 6000);
    return;
  }
  await vscode.window.showInformationMessage('PO Team: ' + relative + ' chưa có nội dung kết quả và chưa tồn tại trong project. Đường dẫn trong kế hoạch chỉ là dự kiến; chờ task trả code hoặc xem mục Kết quả.');
}

class RunsProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  refresh() { this.emitter.fire(); }
  getTreeItem(element) { return element; }
  getChildren(element) {
    if (!element) {
      return store.list().map(run => {
        const item = new vscode.TreeItem(run.title, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = run.id;
        item.contextValue = 'run';
        item.description = run.empty ? '○ Session trống' : (run.ended ? '✓ ' : run.active ? '● ' : '○ ') + run.events + ' sự kiện';
        item.iconPath = new vscode.ThemeIcon(run.errors ? 'warning' : run.ended ? 'pass' : 'sync~spin',
          run.errors ? new vscode.ThemeColor('list.warningForeground') : run.ended ? new vscode.ThemeColor('testing.iconPassed') : undefined);
        item.tooltip = run.id + '\nCập nhật: ' + new Date(run.updated).toLocaleString('vi-VN');
        item.command = { command: 'poTeam.openView', title: 'Mở', arguments: [{ runId: run.id }] };
        item.runId = run.id;
        return item;
      });
    }
    if (element.runId) {
      const run = store.get(element.runId);
      if (!run) return [];
      return R.agentIds(run.state).map(agent => {
        const info = run.state.agents[agent];
        const item = new vscode.TreeItem(R.meta(run.state, agent).name, vscode.TreeItemCollapsibleState.None);
        item.description = R.STATUS[info.status] + (info.task ? ' · ' + info.task : '');
        item.tooltip = info.path || info.task || '';
        const colors = { opus: 'charts.purple', sonnet: 'charts.orange', sol: 'charts.blue' };
        item.iconPath = new vscode.ThemeIcon(agent === run.state.coordinator ? 'account' : 'robot', new vscode.ThemeColor(colors[agent] || 'charts.blue'));
        return item;
      });
    }
    return [];
  }
}

function updateStatus() {
  const runs = store.list();
  const active = runs.filter(run => run.active);
  const errors = active.reduce((sum, run) => sum + run.errors, 0);
  if (active.length) {
    statusItem.text = '$(sync~spin) PO Team ' + active.length;
    statusItem.tooltip = active.map(run => run.title).join('\n');
  } else {
    statusItem.text = '$(organization) PO Team';
    statusItem.tooltip = runs.length ? 'Không có lượt chạy đang hoạt động' : 'Chưa có lượt chạy';
  }
  statusItem.backgroundColor = errors ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  statusItem.show();
}

function nonce() { return crypto.randomBytes(16).toString('base64'); }

function html(webview, context) {
  const media = file => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', file));
  const token = nonce();
  const csp = ["default-src 'none'", `img-src ${webview.cspSource} data: blob:`, `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`, `script-src 'nonce-${token}' ${webview.cspSource}`, `worker-src blob:`].join('; ');
  const imports = {
    three: media('vendor/three.module.js').toString(),
    'three/addons/OrbitControls.js': media('vendor/OrbitControls.js').toString()
  };
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${media('webview.css')}">
<script nonce="${token}" type="importmap">${JSON.stringify({ imports })}</script>
</head><body>
<div id="app"></div>
<script nonce="${token}" src="${media('reducer.js')}"></script>
<script nonce="${token}" type="module" src="${media('webview.js')}"></script>
</body></html>`;
}

function postSnapshot(runId) {
  if (!panel) return;
  const run = store.get(runId);
  panel.webview.postMessage({ type: 'snapshot', runs: store.list(), run: run ? { id: run.id, events: run.events } : null });
  postPlan();
}

function openPanel(context, runId) {
  const remembered = context.workspaceState.get('selectedSession');
  const wanted = runId || panelRun || (store.get(remembered) ? remembered : store.list()[0]?.id) || null;
  panelRun = wanted;
  void context.workspaceState.update('selectedSession', panelRun);
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
    postSnapshot(panelRun);
    return;
  }
  panel = vscode.window.createWebviewPanel('poTeam.view', 'PO Team', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
  panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      panel.webview.postMessage({ type: 'config', defaultView: vscode.workspace.getConfiguration('poTeam').get('defaultView'), layout: context.globalState.get('panelLayout') });
      postSnapshot(panelRun);
      postConnection();
    } else if (message.type === 'layoutSave' && message.layout && typeof message.layout === 'object') {
      // Only small presentation preferences belong in global state, not session data.
      const value = JSON.stringify(message.layout);
      if (value.length < 30000) await context.globalState.update('panelLayout', JSON.parse(value));
    } else if (message.type === 'select' && typeof message.runId === 'string') {
      if (!store.get(message.runId)) return;
      panelRun = message.runId;
      await context.workspaceState.update('selectedSession', panelRun);
      postSnapshot(panelRun);
    } else if (message.type === 'sessionDraft' && typeof message.runId === 'string' && typeof message.text === 'string') {
      if (!store.get(message.runId)) return;
      const drafts = { ...(context.workspaceState.get('sessionDrafts') || {}), [message.runId]: message.text.slice(0, 8000) };
      await context.workspaceState.update('sessionDrafts', drafts);
    } else if (['approveConcept', 'conceptPreview'].includes(message.type)) {
      try { await conceptAction(message); }
      catch (error) { vscode.window.showErrorMessage('PO Team: ' + error.message); }
      finally { panel?.webview.postMessage({ type: 'conceptResult', runId: message.runId }); }
    } else if (['chatPO', 'retryPO', 'answerDecision', 'sessionBudget'].includes(message.type)) {
      try { await sessionControl(message); panel?.webview.postMessage({ type: 'sessionControlResult', runId: message.runId, action: message.type, ok: true }); }
      catch (error) { panel?.webview.postMessage({ type: 'sessionControlResult', runId: message.runId, action: message.type, error: error.message }); vscode.window.showErrorMessage('PO Team: ' + error.message); }
    } else if (message.type === 'pickAttachment') {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: message.kind !== 'folder', canSelectFolders: message.kind === 'folder', defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri, openLabel: message.kind === 'folder' ? 'Đính kèm thư mục' : 'Đính kèm', filters: message.kind === 'image' ? { 'Ảnh': ['png', 'jpg', 'jpeg', 'webp', 'gif'] } : undefined });
      if (picked?.length) {
        const files = [];
        for (const uri of picked.slice(0, 10)) {
          const ext = path.extname(uri.fsPath).toLowerCase(), mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
          const stat = await fs.promises.stat(uri.fsPath);
          if (mime && stat.isFile() && stat.size <= 8 * 1024 * 1024) files.push({ kind: 'image', name: path.basename(uri.fsPath), dataUrl: 'data:' + mime + ';base64,' + (await fs.promises.readFile(uri.fsPath)).toString('base64') });
          else files.push({ kind: stat.isDirectory() ? 'folder' : 'file', name: path.basename(uri.fsPath), path: uri.fsPath });
        }
        panel?.webview.postMessage({ type: 'attachmentsPicked', files });
      }
    } else if (message.type === 'openFile' && typeof message.path === 'string') {
      await openSessionFile(message);
    } else if (message.type === 'imageAction' && ['open', 'save'].includes(message.action)) {
      try { await (message.action === 'open' ? openImage(message) : saveImage(message)); }
      catch (error) { vscode.window.showErrorMessage('PO Team: ' + error.message); }
    } else if (message.type === 'demo') {
      vscode.commands.executeCommand('poTeam.runDemo');
    } else if (message.type === 'changeModel') {
      try { await vscode.commands.executeCommand('poTeam.changeModel', message); }
      finally { panel?.webview.postMessage({ type: 'modelChangeResult', runId: message.runId, agent: message.agent }); }
    } else if (message.type === 'proxyCommand' && ['newSession', 'renameSession', 'connectProxy', 'scanModels', 'startTeam', 'stopTeam', 'pauseTeam', 'resumeTeam', 'generateImage', 'configureMcp', 'manageToolbox', 'openLog', 'reviewChanges', 'applyChanges', 'openReport', 'addWork'].includes(message.command)) {
      vscode.commands.executeCommand('poTeam.' + message.command, message.input);
    } else if (message.type === 'roles') {
      const profile = connectionInfo();
      const roles = message.roles;
      if (R.AGENTS.every(agent => typeof roles?.[agent] === 'string' && profile.models.some(model => model.id === roles[agent]))) {
        await extensionContext.globalState.update('proxyProfile', { ...profile, roles }); postConnection();
      }
    } else if (message.type === 'coordinator') {
      const profile = connectionInfo();
      if (profile.models.some(model => model.id === message.model)) {
        await extensionContext.globalState.update('proxyProfile', { ...profile, coordinator: message.model }); postConnection();
      }
    } else if (message.type === 'executePlan') {
      vscode.commands.executeCommand('poTeam.executePlan', { runId: message.runId, assignments: message.assignments });
    } else if (message.type === 'stopAgent') {
      vscode.commands.executeCommand('poTeam.stopAgent', { runId: message.runId, agent: message.agent });
    } else if (message.type === 'addWork') {
      vscode.commands.executeCommand('poTeam.addWork', { runId: message.runId, newRole: message.newRole === true });
    } else if (message.type === 'rendered') {
      renderState = { ...renderState, view: message.view, events: message.events };
      output.appendLine('Rendered ' + message.view + ' · ' + message.events + ' events');
    } else if (message.type === 'officeReady') {
      renderState.officeReady = true;
    }
  }, null, context.subscriptions);
  panel.webview.html = html(panel.webview, context);
}

function activate(context) {
  extensionContext = context;
  const errorNotices = new ErrorNotices();
  emptyProjectId = context.workspaceState.get('emptyProjectId') || crypto.randomUUID();
  void context.workspaceState.update('emptyProjectId', emptyProjectId);
  output = vscode.window.createOutputChannel('PO Team');
  store = new Store(eventsDir);
  const provider = new RunsProvider();
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'poTeam.openView';

  context.subscriptions.push(
    output, statusItem,
    vscode.workspace.registerTextDocumentContentProvider('po-team-preview', { provideTextDocumentContent: uri => previews.get(uri.toString()) || '' }),
    vscode.window.registerTreeDataProvider('poTeam.runs', provider),
    vscode.commands.registerCommand('poTeam.openView', arg => openPanel(context, arg && arg.runId)),
    vscode.commands.registerCommand('poTeam.refresh', () => store.poll()),
    vscode.commands.registerCommand('poTeam.revealEventsDir', async () => {
      const dir = eventsDir();
      await fs.promises.mkdir(dir, { recursive: true });
      vscode.env.openExternal(vscode.Uri.file(dir));
    }),
    vscode.commands.registerCommand('poTeam.clearRun', async arg => {
      const id = arg && arg.runId;
      if (!id) return;
      if (running.has(id) || pending.has(id)) return vscode.window.showInformationMessage('Dừng hoặc hủy plan trước khi xóa lượt này.');
      const pick = await vscode.window.showWarningMessage('Xóa nhật ký của lượt chạy "' + id + '"?', { modal: true }, 'Xóa');
      if (pick === 'Xóa') await store.remove(id);
    }),
    vscode.commands.registerCommand('poTeam.runDemo', () => {
      const { run, finished } = startDemo(eventsDir());
      output.appendLine('Demo ' + run);
      setTimeout(() => openPanel(context, run), 600);
      finished.catch(error => output.appendLine('Demo lỗi: ' + error.message));
    }),
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration('poTeam.eventsDir')) {
        for (const runner of running.values()) runner.cancel();
        pending.clear(); completed.clear(); panelRun = null;
        await store.poll();
        await restoreDrafts();
        if (!store.get(panelRun)) panelRun = store.list()[0]?.id || null;
        postSnapshot(panelRun);
        postConnection();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      for (const runner of running.values()) runner.cancel();
      pending.clear(); completed.clear(); panelRun = null;
      await store.poll(); await restoreDrafts(); postSnapshot(null); postConnection();
    })
  );

  const commands = { newSession, renameSession, connectProxy, scanModels, startTeam, executePlan, addWork, stopAgent, changeModel, openReport, reviewChanges, applyChanges, generateImage, pauseTeam, resumeTeam, configureMcp, connectUnityMcp, manageToolbox, openLog,
    stopTeam: async () => {
      if (running.has(panelRun)) running.get(panelRun).cancel();
      else if (pending.has(panelRun)) {
        const runner = pending.get(panelRun); runner.cancel(); pending.delete(panelRun);
        runner.phase = 'ended'; await runner.saveState();
        await runner.event('lead', 'end', { text: 'Đã hủy plan' }); await store.poll(); postConnection();
      }
      else vscode.window.showInformationMessage('Không có team đang chạy trong lượt này.');
    } };
  for (const [name, action] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand('poTeam.' + name, async arg => {
    try { return await action(arg); } catch (error) { vscode.window.showErrorMessage('PO Team: ' + error.message); output.appendLine('Lỗi: ' + error.message); }
  }));

  store.on('change', () => {
    provider.refresh(); updateStatus();
    if (panel) panel.webview.postMessage({ type: 'runs', runs: store.list() });
  });
  store.on('fault', error => output.appendLine('Nhật ký: ' + error.message));
  store.on('added', (id, live) => {
    if (live && vscode.workspace.getConfiguration('poTeam').get('autoOpen')) openPanel(context, id);
  });
  store.on('events', (id, events, live) => {
    if (panel && id === panelRun) { panel.webview.postMessage({ type: 'events', runId: id, events }); postPlan(); }
    else if (panel && !panelRun) { panelRun = id; postSnapshot(id); }
    if (!live || !vscode.workspace.getConfiguration('poTeam').get('notify')) return;
    for (const event of events) {
      if (event.type === 'end') {
        const notice = completionNotice(store.get(id)?.state, event);
        const show = notice.warning ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
        show(notice.text, 'Mở').then(pick => { if (pick) openPanel(context, id); });
      } else if (event.type === 'error') {
        const message = errorNotices.next(id, event);
        if (message) vscode.window.showWarningMessage('PO Team: ' + message, 'Mở').then(pick => { if (pick) openPanel(context, id); });
      }
    }
  });
  store.on('reset', id => { if (panel && id === panelRun) postSnapshot(id); });
  store.on('removed', id => { if (panelRun === id) { panelRun = null; postSnapshot(null); } });
  store.on('added', () => { if (panel) postSnapshot(panelRun); });
  updateStatus();
  context.subscriptions.push({ dispose: () => store.stop() });
  void store.poll().then(restoreDrafts).then(() => { store.start(); postConnection(); postSnapshot(panelRun); }).catch(error => { store.start(); output.appendLine(error.message); });
  if (context.extensionMode === vscode.ExtensionMode.Test) return {
    getState: () => ({ runs: store.list(), render: renderState, eventsDirectory: eventsDir() }),
    open: id => openPanel(context, id),
    navigate: view => panel?.webview.postMessage({ type: 'testNavigate', view }),
    close: () => panel?.dispose()
  };
}

async function deactivate() { if (store) store.stop(); for (const runner of new Set([...running.values(), ...pending.values()])) { runner.modelSwitches.dispose(); runner.cancel(); } await Promise.allSettled([...running.values()].map(runner => runner.mcp?.close())); }

module.exports = { activate, deactivate };
