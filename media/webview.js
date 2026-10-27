import { createLayout } from './layout.js';
const vscode = acquireVsCodeApi();
const R = window.PoReducer;
const saved = vscode.getState() || {};
const VIEWS = { office: 'Office 3D', board: 'Bảng việc', results: 'Kết quả', log: 'Log', timeline: 'Timeline', graph: 'Luồng việc', stats: 'Tài nguyên' };
const PRIMARY_VIEWS = ['office', 'board', 'results', 'log'];
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ sidebar:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', plus:'<path d="M12 5v14M5 12h14"/>', settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--card)"/><circle cx="15" cy="17" r="3" fill="var(--card)"/>', more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>', request:'<path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/>', plan:'<path d="M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01"/>', play:'<path d="m9 5 11 7-11 7V5Z"/>', pause:'<path d="M8 5v14M16 5v14"/>', connect:'<path d="m8 4-4 4 4 4M16 12l4 4-4 4M14 4l-4 16"/>', edit:'<path d="m16 3 5 5-12 12H4v-5L16 3Z"/>' })[name] || ''}</svg>`;
const LABELS = { stall: 'Chờ model lâu', model_failover: 'PO đổi model', retry: 'Thử lại kết nối', result: 'Trả kết quả', stopped: 'Đã dừng', queued: 'Bổ sung việc', team: 'Cập nhật team', ready: 'Plan sẵn sàng', start: 'Bắt đầu', plan: 'Lập kế hoạch', assign: 'Giao việc', working: 'Đang làm', file: 'Sửa file', note: 'Ghi chú', done: 'Hoàn tất', review: 'Review', approved: 'Duyệt', rework: 'Yêu cầu sửa', error: 'Lỗi', end: 'Kết thúc' };
Object.assign(LABELS, { paused: 'Tạm dừng', resumed: 'Tiếp tục' });
Object.assign(LABELS, { handover: 'Chuyển quyền PO' });
Object.assign(LABELS, { model_switch_requested: 'Chờ bàn giao model', model_switch_applied: 'Đã đổi model', model_switch_interrupted: 'Tiếp tục task bằng model mới' });
const app = document.getElementById('app');
app.innerHTML = `<header class="topbar">
  <button id="sidebar-toggle" class="icon-button" aria-label="Thu gọn danh sách team" title="Ẩn / hiện danh sách team">${icon('sidebar')}</button>
  <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>PO Team</div><span class="header-divider"></span><span id="project-name" class="project-name">Project đang mở</span><span class="spacer"></span>
  <details id="tools-menu" class="menu"><summary class="quiet" aria-label="Công cụ" title="Công cụ">${icon('settings')}<span>Công cụ</span></summary><div class="menu-popover">
    <button data-command="generateImage">Tạo ảnh</button><button data-command="configureMcp">Kết nối MCP</button><button id="proxy-toggle" data-panel="proxy" aria-expanded="false">Proxy & model</button><button data-view="stats">Tài nguyên & ngân sách</button><button data-panel="replay">Phát lại hoạt động</button><hr>
    <button id="focus-mode" aria-pressed="false">Tập trung</button><button id="demo">Chạy demo</button>
    <details class="layout-menu"><summary>Bố cục</summary><div>${Object.entries({sidebar:'Danh sách team',feed:'Hoạt động trên 3D',detail:'Chi tiết vị trí'}).map(([key,title]) => `<label><input type="checkbox" data-layout-open="${key}">${title}</label>`).join('')}<button id="layout-reset" class="quiet">Đặt lại bố cục</button></div></details>
  </div></details>
</header>
<div class="studio-shell">
  <aside id="sidebar" class="sidebar" aria-label="Session và đội ngũ">
    <section id="sessions-panel" class="sessions-panel"><div class="sidebar-heading"><span>Session <span id="session-count" class="small"></span></span><div><button id="rename-session" class="icon-button" aria-label="Đổi tên session" title="Đổi tên session">${icon('edit')}</button><button id="new-session" class="icon-button" aria-label="Session mới" title="Tạo session mới">${icon('plus')}</button></div></div><div id="session-body"><select id="runs" aria-label="Chọn session trong project"></select><span id="session-summary" hidden></span></div></section>
    <div class="sidebar-actions"><button id="request-toggle" class="quiet" data-panel="composer" title="Yêu cầu đã gửi và giao việc">${icon('request')}<span>Yêu cầu</span></button><button id="plan-shortcut" class="quiet" data-panel="plan" title="Xem kế hoạch và phân công">${icon('plan')}<span>Kế hoạch</span><span id="plan-count" class="count"></span></button></div>
    <button id="concept-shortcut" class="chat-shortcut quiet" data-panel="concept" hidden>${icon('plan')}<span>Đề xuất & demo</span></button><button id="chat-shortcut" class="chat-shortcut quiet" data-panel="chat">${icon('request')}<span>Chat với PO</span><span id="decision-count" class="count"></span></button>
    <section id="agents-panel" class="agents-panel"><div class="sidebar-heading"><span>Đội ngũ</span><span id="agents-summary" class="small"></span></div><div id="agents" class="roster" aria-label="Các vị trí trong team"></div></section>
    <button id="connection-shortcut" class="connection-shortcut" data-panel="proxy" title="Kết nối proxy và chọn model"><i id="connection-dot"></i><span id="connection-label">Chưa kết nối proxy</span>${icon('settings')}</button>
  </aside>
  <button id="sidebar-backdrop" class="sidebar-backdrop" aria-label="Đóng danh sách team"></button>
  <section id="workbench" class="workbench" aria-label="Theo dõi session">
    <div class="session-heading"><div class="session-identity"><h1 id="run-title">Chọn một session</h1><p id="session-caption">Giao mục tiêu cho PO để bắt đầu.</p><div id="session-progress" class="session-progress" hidden><span></span></div></div><div class="session-control"><div id="chips" class="chips"></div><button id="pause-run" class="quiet" data-command="pauseTeam" hidden>${icon('pause')}<span>Tạm dừng</span></button><button id="resume-run" class="primary" data-command="resumeTeam" hidden>${icon('play')}<span>Tiếp tục</span></button><details class="menu session-menu"><summary class="icon-button" aria-label="Thao tác session" title="Thao tác session">${icon('more')}</summary><div class="menu-popover"><button id="add-task" disabled>Giao thêm task</button><button id="add-role" disabled>Thêm vị trí</button><hr><button data-command="openReport">Mở báo cáo</button><button data-command="reviewChanges">Xem thay đổi</button><button id="apply-session" data-command="applyChanges" disabled>Áp dụng đề xuất</button><hr><button class="danger-text" data-command="stopTeam">Dừng cả team</button></div></details></div></div>
    <div id="session-alert" class="session-alert" hidden><span id="session-alert-text"></span><button id="session-alert-action" class="quiet"></button></div>
    <nav class="viewbar" aria-label="Kiểu theo dõi"><div class="tabs" role="tablist">${PRIMARY_VIEWS.map(key => `<button class="tab" role="tab" id="tab-${key}" aria-controls="${key}" data-view="${key}">${VIEWS[key]}${key === 'results' ? '<span id="result-count" class="count"></span>' : ''}</button>`).join('')}</div><details id="more-views" class="menu more-views"><summary class="quiet"><span id="more-view-label">Khác</span><span aria-hidden="true">⌄</span></summary><div class="menu-popover">${Object.entries(VIEWS).filter(([key]) => !PRIMARY_VIEWS.includes(key)).map(([key,title]) => `<button id="tab-${key}" data-view="${key}" aria-controls="${key}">${title}</button>`).join('')}</div></details><span class="spacer"></span><span id="progress-label" class="small"></span></nav>
    <div id="workspace"><main id="stage">
      <div class="pane" id="office" role="tabpanel" aria-labelledby="tab-office"><div id="office-fallback" hidden></div><aside id="feed-panel" class="feed folded"><button id="feed-toggle" class="fold-button" aria-expanded="false" aria-controls="feed">Hoạt động</button><div id="feed"></div></aside><div class="hint">Kéo để xoay · Cuộn để thu phóng</div><button id="reset-camera" class="camera-button" title="Đặt lại góc nhìn">Đặt lại góc nhìn</button></div>
      <div class="pane" id="board" role="tabpanel" aria-labelledby="tab-board"></div>
      <div class="pane scroll" id="results" role="tabpanel" aria-labelledby="tab-results"></div>
      <div class="pane" id="log" role="tabpanel" aria-labelledby="tab-log"><div class="log-toolbar"><input id="log-search" aria-label="Tìm trong log" placeholder="Tìm trong log…"><select id="log-filter" aria-label="Lọc log"><option value="all">Cả team</option><option value="errors">Cần xử lý</option><option value="tech">Tech</option></select><label><input id="log-follow" type="checkbox" checked> Theo dõi</label><button class="quiet" data-command="openLog">Mở log đầy đủ</button><span id="log-count" class="small"></span></div><div id="log-lines" class="log-lines" role="log" aria-label="Nhật ký gộp cả team"></div></div>
      <div class="pane scroll" id="timeline" role="tabpanel" aria-labelledby="tab-timeline"></div><div class="pane scroll" id="graph" role="tabpanel" aria-labelledby="tab-graph"></div><div class="pane scroll" id="stats" role="tabpanel" aria-labelledby="tab-stats"></div>
      <div id="welcome" class="welcome" hidden><div class="welcome-symbol">${icon('request')}</div><h2>Mục tiêu tiếp theo của team?</h2><p>Tạo session, giao mục tiêu cho PO.<br>Theo dõi tiến độ và nhận kết quả tại đây.</p><button class="primary" data-command="newSession">Tạo session mới</button><button id="welcome-demo" class="quiet">Xem demo</button></div>
      <aside id="agent-detail" class="agent-detail" hidden aria-label="Chi tiết vị trí"></aside>
    </main></div>
    <div class="activity-status"><i id="activity-dot"></i><span id="latest-activity">Chưa có hoạt động</span><button id="activity-log" data-view="log" title="Xem log">Xem log</button></div>
  </section>
  <button id="inspector-backdrop" class="inspector-backdrop" aria-label="Đóng bảng điều khiển" hidden></button>
  <aside id="inspector" class="inspector" aria-label="Điều khiển session" hidden><div class="inspector-heading"><div><h2 id="inspector-title"></h2><p id="inspector-caption"></p></div><button id="close-inspector" class="icon-button" aria-label="Đóng bảng điều khiển">${icon('close')}</button></div><div class="inspector-scroll">
    <section id="composer-panel" class="inspector-pane" hidden><details id="submitted-request" hidden open><summary>Yêu cầu đã gửi</summary><pre id="submitted-request-text" class="submitted-request-text" tabindex="0"></pre></details><details id="new-request-fold" open><summary id="composer-summary">Giao mục tiêu cho PO</summary><div id="composer-body" class="composer"><div class="project-row"><label><input type="checkbox" id="read-workspace" checked> Đọc project đang mở</label></div><div id="project-path" class="small"></div><textarea id="new-request" aria-label="Yêu cầu mới cho project" maxlength="8000" rows="6" placeholder="Mô tả kết quả bạn muốn nhận…"></textarea><p id="source-status" class="small"></p><button id="new-team" class="primary">Gửi yêu cầu</button></div></details></section>
    <section id="concept-panel" class="inspector-pane" hidden><div id="concept-content"></div></section>
    <section id="chat-panel" class="inspector-pane" hidden><div id="po-messages" role="log" aria-label="Hội thoại với PO"></div><div id="ceo-decisions"></div><form id="po-chat-form" class="po-chat-form"><label for="po-chat-input" class="sr-only">Nhắn cho PO</label><div id="chat-drop" class="chat-compose"><div id="chat-attachments" class="chat-attachments" hidden></div><textarea id="po-chat-input" maxlength="8000" rows="2" placeholder="Nhắn PO… (Enter gửi · Shift+Enter xuống dòng)"></textarea><div class="chat-tools"><div class="attach-wrap"><button type="button" id="attach-toggle" class="chat-icon" title="Đính kèm ảnh, file, thư mục" aria-label="Đính kèm" aria-expanded="false">+</button><div id="attach-menu" class="attach-menu" hidden><button type="button" data-attach="image">🖼 Ảnh</button><button type="button" data-attach="file">📎 File</button><button type="button" data-attach="folder">📁 Thư mục</button></div></div><button id="po-chat-send" class="chat-icon chat-send" type="submit" title="Gửi (Enter)" aria-label="Gửi">➤</button></div></div><p id="po-chat-hint" class="sr-only"></p><p id="control-feedback" class="small chat-feedback" role="status"></p></form></section>
    <section id="plan-panel" class="inspector-pane" hidden aria-label="Kế hoạch và phân công"><p id="plan-summary" class="inspector-summary"></p><div id="plan-body"></div><p id="plan-empty" class="empty">Gửi yêu cầu để PO đề xuất team và kế hoạch.</p></section>
    <section id="proxy-config" class="inspector-pane proxy-config" hidden><p id="proxy-status"></p><div class="team-actions"><button class="primary" data-command="connectProxy">Kết nối proxy</button><button class="quiet" data-command="scanModels">Quét model</button></div><div id="roles" class="roles"></div><p id="proxy-note" class="small"></p></section>
    <section id="replay-panel" class="inspector-pane" hidden><p class="small">Xem lại hoạt động đã ghi. Chọn Trực tiếp để trở về hiện tại.</p><footer id="replay-body"><button id="live" class="live" aria-pressed="true">● Trực tiếp</button><button id="play" aria-label="Phát lại">▶</button><select id="speed" aria-label="Tốc độ phát lại"><option value="700">1×</option><option value="350">2×</option><option value="1400">0.5×</option></select><input id="scrub" aria-label="Vị trí phát lại" type="range" min="0" max="0" value="0"><span id="position" class="time">0 / 0</span></footer></section>
  </div></aside>
</div>`

const element = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = stamp => stamp ? new Date(stamp).toLocaleTimeString('vi-VN', { hour12: false }) : '—';
const duration = value => value < 1000 ? '<1s' : value < 60000 ? Math.round(value / 1000) + 's' : Math.floor(value / 60000) + 'm ' + Math.round(value % 60000 / 1000) + 's';
const short = (value, max = 25) => value?.length > max ? value.slice(0, max - 1) + '…' : value || '';
const statusLabel = status => ({ failed: 'Lỗi', blocked: 'Bị chặn', queued: 'Chờ thực hiện', pending: 'Chờ thực hiện' })[status] || R.STATUS[status] || status || 'Chờ thực hiện';
const fileLink = path => `<button class="fchip" data-file="${escape(path)}" title="${escape(path)}">${escape(R.baseName(path))}</button>`;
let view = VIEWS[saved.view] ? saved.view : 'office';
let runId = null;
let events = [];
let cursor = 0;
let live = true;
let playback = null;
let state = R.emptyState();
let office = null;
let officeLoading = false;
let connection = { models: [], roles: {} };
let draft = null;
let details = { data: null, report: '' };
const composerDrafts = new Map();
let selectedAgent = null;
let planSignature = '';
let layout;
const selections = new Map();
const modelDrafts = new Map();
const modelSending = new Set();
const chatDrafts = new Map(), controlSending = new Set(), sentTexts = new Map();
let chatSignature = '', resourceSignature = '', conceptSignature = '';
const conceptSending = new Set();
const imageModel = model => /(?:^|[\/_-])(?:gpt-image|dall-e|imagen|flux)(?:$|[\/_-])/i.test(model || '');
const agentIds = () => R.agentIds(state);
const meta = id => R.meta(state, id);
const modelOptions = () => connection.models.map(model => `<option value="${escape(model.id)}">${escape(model.id)}</option>`).join('');

function renderPlan() {
  const current = details.runId === runId ? details : {};
  const plan = draft?.runId === runId && draft.plan || current.data?.plan;
  const phase = draft?.runId === runId && draft.phase || current.data?.phase;
  const editable = draft?.runId === runId && draft.editable;
  element('add-task').disabled = element('add-role').disabled = !editable;
  element('plan-shortcut').disabled = !plan;
  element('plan-count').textContent = plan ? plan.tasks.length : '';
  element('plan-empty').hidden = !!plan;
  element('plan-summary').textContent = plan ? `${plan.roles.length} vị trí · ${plan.tasks.length} task${phase === 'ready' ? ' · Chờ bạn bắt đầu' : ''}` : '';
  const signature = JSON.stringify([runId, plan, phase, connection.models, current.data?.schedule]);
  if (signature === planSignature) return;
  planSignature = signature;
  if (!plan) { element('plan-body').innerHTML = ''; return; }
  if (!selections.has(runId)) selections.set(runId, Object.fromEntries(plan.roles.map(role => [role.id, role.model])));
  const chosen = selections.get(runId), ready = phase === 'ready';
  const approvedOption = current.data?.concept?.options.find(option => option.id === current.data.concept.approved?.optionId);
  const estimateNote = approvedOption ? `Ước tính ban đầu cho hướng đã duyệt: ${approvedOption.estimate.minMinutes}–${approvedOption.estimate.maxMinutes} phút. Lịch dưới đây được tính lại theo task và phụ thuộc thực tế; xem trước khi bắt đầu.` : '';
  for (const role of plan.roles) if (!chosen[role.id]) chosen[role.id] = role.model;
  const titles = Object.fromEntries(plan.tasks.map(task => [task.id, task.title]));
  element('plan-body').innerHTML = `<p class="plan-summary">${escape(plan.summary)}</p>${estimateNote ? `<p class="small">${escape(estimateNote)}</p>` : ''}<p class="small">Dự kiến ${current.data?.schedule?.estimatedMinutes || '—'} phút gồm review ${current.data?.schedule?.reviewMinutes || 3} phút và dự phòng ${current.data?.schedule?.contingencyMinutes || 0} phút · Tối đa 3 vị trí song song. Deadline tính khi bắt đầu.</p><details><summary>Quy tắc sản xuất & nghiệm thu</summary><ul>${(current.data?.schedule?.rules || []).map(rule => `<li>${escape(rule)}</li>`).join('')}</ul></details><div class="plan-roles">${plan.roles.map(role => `<article class="plan-role"><h3>${escape(role.name)}</h3><p>${escape(role.responsibility)}</p>${current.data?.schedule?.roles?.[role.id]?.deadlineAt ? `<p class="small">Hạn vị trí: ${time(current.data.schedule.roles[role.id].deadlineAt)}</p>` : ''}${ready ? `<label>Model thực hiện<select data-assignment="${escape(role.id)}">${modelOptions()}</select></label>` : `<span class="small">${escape(role.model)}</span>`}${ready && role.reason ? `<p class="small">${escape(role.reason)}</p>` : ''}</article>`).join('')}</div><h3>Danh sách công việc</h3><div class="plan-tasks">${plan.tasks.map(task => `<details data-fold-key="${escape(runId + ':plan:' + task.id)}"><summary><span>${escape(task.title)}</span><span class="small">${escape(plan.roles.find(role => role.id === task.roleId)?.name)}</span></summary><p>${escape(task.instruction)}</p>${deadlineLabel(task)}<div class="small">Phạm vi: ${escape(task.scope.join(', ') || 'Phân tích')}</div><div class="small">Phụ thuộc: ${escape(task.dependsOn.map(id => titles[id]).join(', ') || 'Độc lập')}</div>${task.acceptance?.length ? '<h4>Tiêu chí nghiệm thu</h4><ul>' + task.acceptance.map(item => `<li>${escape(item.description)}</li>`).join('') + '</ul>' : ''}</details>`).join('')}</div>${ready ? '<div class="plan-footer"><span class="small">Tối đa 3 việc độc lập chạy đồng thời. PO kiểm tra và báo cáo kết quả.</span><button id="execute-plan" class="primary">Bắt đầu thực hiện</button></div>' : ''}`;
  for (const select of element('plan-body').querySelectorAll('[data-assignment]')) {
    select.value = chosen[select.dataset.assignment] || '';
    select.onchange = () => { chosen[select.dataset.assignment] = select.value; };
  }
  layout?.refresh();
  if (element('execute-plan')) element('execute-plan').onclick = () => {
    element('execute-plan').disabled = true;
    vscode.postMessage({ type: 'executePlan', runId, assignments: chosen });
    layout.close();
    setTimeout(() => { const button = element('execute-plan'); if (button) button.disabled = false; }, 1500);
  };
}

function renderConnection(message) {
  connection = message;
  element('proxy-status').textContent = message.base ? `${message.base} · ${message.models.length} model` : 'Chưa kết nối proxy';
  element('roles').innerHTML = `<label>Model PO cho session mới<select id="coordinator" aria-label="Model PO">${modelOptions()}</select></label><p class="small">PO phân tích project Unity, chia việc và báo cáo kết quả cho bạn.</p>`;
  element('coordinator').value = message.coordinator || message.roles?.opus || '';
  element('proxy-note').textContent = message.base ? 'API key lưu trong SecretStorage. Thay đổi code cần bạn xem và áp dụng; không tự ghi file.' : 'Nhập base URL và API key. Danh sách model được lấy trực tiếp từ proxy.';
  const project = message.project || { name: 'Project demo', roots: [], trusted: false };
  element('project-name').textContent = project.name;
  element('project-name').title = project.roots.join(' · ');
  element('connection-label').textContent = message.base ? `${message.models.length} model · Đã kết nối` : 'Chưa kết nối proxy';
  element('connection-dot').classList.toggle('connected', !!message.base);
  element('project-path').textContent = project.roots.join(' · ') || 'Chưa mở thư mục project. Mở folder trong VS Code để đọc source.';
  element('read-workspace').disabled = !project.trusted || !project.roots.length;
  if (element('read-workspace').disabled) element('read-workspace').checked = false;
  renderPlan();
  renderSource();
  renderAgentDetail();
}

function renderSource() {
  const current = details.runId === runId ? details : {};
  const phase = current.data?.phase;
  element('pause-run').disabled = !current.canPause;
  element('resume-run').disabled = !current.canResume;
  element('pause-run').hidden = !current.canPause;
  element('resume-run').hidden = !current.canResume;
  element('apply-session').disabled = !current.canApply;
  const request = typeof current.data?.request === 'string' ? current.data.request : '';
  element('submitted-request').hidden = !request;
  element('submitted-request-text').textContent = request;
  const root = current.data?.root, fresh = phase === 'new';
  element('source-status').textContent = fresh ? 'PO phân tích yêu cầu, đề xuất team và kế hoạch trước khi thực hiện.' : root ? 'Session mới dùng project: ' + root : 'Yêu cầu mới sẽ tạo một session riêng.';
  element('composer-summary').textContent = request ? 'Giao yêu cầu mới' : 'Giao mục tiêu cho PO';
  element('new-team').textContent = fresh ? 'Gửi yêu cầu cho PO' : 'Tạo session từ yêu cầu';
  element('rename-session').disabled = !runId;
  renderPlan(); renderSessionSummary(); renderCollaboration(); renderConcept();
}
function sessionFacts() {
  const current = details.runId === runId ? details : {};
  const tasks = taskOutputs();
  const complete = tasks.filter(task => ['done', 'approved', 'review'].includes(task.status)).length;
  const attention = tasks.filter(task => ['error', 'failed', 'blocked', 'stopped', 'rework'].includes(task.status)).length;
  const phase = (live && current.data?.phase) || (state.ended ? 'ended' : state.paused ? 'paused' : state.agents[state.coordinator]?.status === 'planning' ? 'planning' : '');
  return { current, tasks, complete, attention, phase };
}
function renderSessionSummary() {
  const { current, tasks, complete, attention, phase } = sessionFacts();
  const working = agentIds().filter(id => ['working', 'planning', 'review'].includes(state.agents[id].status)).length;
  const phaseLabels = { concept_planning:'PO đang đề xuất hướng', awaiting_concept:'Chờ CEO duyệt hướng', new:'Chưa giao việc', ready:'Kế hoạch sẵn sàng', planning:'PO đang lập kế hoạch', running:'Team đang làm', reviewing:'PO đang kiểm tra', pausing:'Đang tạm dừng', paused:'Đã tạm dừng', ended: attention || current.data?.approved === false || current.data?.error ? 'Cần xử lý thêm' : current.data?.approved === true ? 'Đã được PO duyệt' : 'Đã kết thúc' };
  const label = !live ? 'Đang phát lại' : phaseLabels[phase] || (working ? 'Team đang làm' : runId ? 'Chờ thực hiện' : 'Chưa chọn session');
  element('chips').innerHTML = `<span class="chip ${phase === 'running' || phase === 'planning' ? 'running' : attention ? 'attention' : ''}"><i></i>${escape(label)}</span>`;
  element('run-title').textContent = state.title || (phase === 'new' ? 'Session mới' : 'Không gian làm việc');
  element('run-title').title = state.title || '';
  element('session-caption').textContent = tasks.length ? `${tasks.length} task${working && !state.ended && !state.paused ? ' · ' + working + ' vị trí đang làm' : ''}${attention ? ' · ' + attention + ' cần xử lý' : ''}` : runId ? 'Bạn giao mục tiêu. PO tổ chức team và báo cáo kết quả.' : 'Chọn session hoặc bắt đầu một mục tiêu mới.';
  element('progress-label').textContent = tasks.length ? `${complete}/${tasks.length} có kết quả` : '';
  element('session-progress').hidden = !tasks.length;
  element('session-progress').firstElementChild.style.width = (tasks.length ? Math.round(complete / tasks.length * 100) : 0) + '%';
  element('session-progress').classList.toggle('attention', !!attention);
  element('result-count').textContent = complete || '';
  const alert = element('session-alert'), text = element('session-alert-text'), action = element('session-alert-action');
  alert.hidden = !live || !['new', 'awaiting_concept', 'ready', 'paused', 'pausing'].includes(phase) && !(phase === 'ended' && (current.canResume || attention));
  alert.classList.toggle('attention', phase === 'ended');
  action.hidden = phase === 'pausing';
  if (phase === 'awaiting_concept') { text.textContent = 'PO đã trình bày hướng làm, demo và ước tính. Duyệt hướng trước khi chia team.'; action.textContent = 'Xem & chọn hướng'; action.onclick = () => layout.open('concept'); }
  else if (phase === 'ready') { text.textContent = 'PO đã đề xuất team. Kiểm tra phân công trước khi chạy.'; action.textContent = 'Xem & bắt đầu'; action.onclick = () => layout.open('plan'); }
  else if (phase === 'new') { text.textContent = 'Session đang trống. Giao mục tiêu để PO lên kế hoạch.'; action.textContent = 'Giao mục tiêu'; action.onclick = () => layout.open('composer'); }
  else if (phase === 'paused' || phase === 'pausing') { text.textContent = phase === 'pausing' ? 'Đang lưu tiến độ và dừng request…' : 'Tiến độ đã lưu. Tiếp tục để làm phần còn lại trong session này.'; action.textContent = 'Xem tiến độ'; action.onclick = () => chooseView('board'); }
  else { text.textContent = 'Session còn phần việc chưa đạt. Kết quả đã có được giữ lại.'; action.textContent = 'Xem phần cần xử lý'; action.onclick = () => chooseView('board'); }
  const schedule = current.data?.schedule;
  if (schedule && ['running','reviewing'].includes(phase)) element('session-caption').textContent += ` · ETA ${time(schedule.projectedFinishAt)}${Date.now() > Date.parse(schedule.originalFinishAt) ? ' · Đang trễ lịch ban đầu' : ''}`;
  const latest = events[Math.max(0, cursor - 1)];
  element('latest-activity').textContent = latest ? `${time(latest.ts)}  ${meta(latest.agent).short}: ${String(latest.task || latest.text || LABELS[latest.type] || latest.type).replace(/\s+/g, ' ')}` : 'Chưa có hoạt động';
  element('activity-dot').style.background = latest?.type === 'error' ? 'var(--warn)' : 'var(--muted)';
  const choices = current.data?.collaboration?.decisions?.filter(item => item.status === 'pending').length || 0;
  if (live && choices) { alert.hidden = false; alert.classList.add('attention'); text.textContent = `${choices} quyết định đang chờ bạn chọn.`; action.hidden = false; action.textContent = 'Xem lựa chọn'; action.onclick = () => layout.open('chat'); }
}

function persist() { vscode.setState({ view, runId, layout: layout?.snapshot() || saved.layout }); }
function stop() { clearInterval(playback); playback = null; element('play').textContent = '▶'; }
function chooseView(next) {
  if (!VIEWS[next]) return;
  view = next;
  for (const key of Object.keys(VIEWS)) {
    const selected = key === view;
    element(key).classList.toggle('on', selected);
    element('tab-' + key).classList.toggle('on', selected);
    element('tab-' + key).setAttribute('aria-selected', selected);
    element('tab-' + key).tabIndex = !PRIMARY_VIEWS.includes(key) || selected || !PRIMARY_VIEWS.includes(view) && key === 'office' ? 0 : -1;
  }
  element('more-view-label').textContent = PRIMARY_VIEWS.includes(view) ? 'Khác' : VIEWS[view];
  element('more-views').classList.toggle('active', !PRIMARY_VIEWS.includes(view));
  closeMenus();
  office?.setActive(view === 'office');
  if (view === 'office') loadOffice();
  persist(); renderView();
}
async function loadOffice() {
  if (office || officeLoading) return;
  officeLoading = true;
  try {
    const { createOffice } = await import('./office.mjs');
    office = createOffice(element('office'), path => vscode.postMessage({ type: 'openFile', path, runId }), showAgent);
    office.update(state, null, true);
    office.setActive(view === 'office');
    vscode.postMessage({ type: 'officeReady' });
  } catch (error) {
    element('office-fallback').hidden = false;
    element('office-fallback').textContent = 'Không khởi tạo được 3D. Bạn vẫn có thể dùng Bảng việc, Timeline và Luồng việc. ' + error.message;
    vscode.postMessage({ type: 'rendered', view: 'office-error', events: cursor });
  }
}
function runOptions(runs) {
  element('session-count').textContent = '(' + runs.length + ')';
  element('runs').innerHTML = runs.length ? runs.map(run => `<option value="${escape(run.id)}">${run.paused ? '⏸' : run.ended ? '✓' : run.active ? '●' : '○'} ${escape(run.title)}</option>`).join('') : '<option>Chưa có session</option>';
  element('runs').disabled = !runs.length;
  if (runId) element('runs').value = runId;
}
function rebuild() {
  state = R.reduce(events.slice(0, cursor));
  office?.update(state, null, true);
  render();
}
function setLive(value) {
  live = value;
  element('live').classList.toggle('off', !live);
  element('live').setAttribute('aria-pressed', live);
}
function renderRoster() {
  element('agents-summary').textContent = agentIds().length ? agentIds().length + ' vị trí' : '';
  const scroll = element('agents').scrollTop;
  const rank = agent => agent === state.coordinator ? 0 : ['error', 'rework', 'stopped'].includes(state.agents[agent].status) ? 1 : ['working', 'review', 'planning', 'assigned'].includes(state.agents[agent].status) ? 2 : ['done', 'approved'].includes(state.agents[agent].status) ? 4 : 3;
  const order = agentIds().map((agent, index) => [agent, index]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([agent]) => agent);
  element('agents').innerHTML = order.map(agent => {
    const metadata = meta(agent), info = state.agents[agent];
    const busy = ['working', 'review', 'planning'].includes(info.status) && !state.ended && !state.paused;
    const attention = ['error', 'rework', 'stopped'].includes(info.status);
    const pending = info.modelSwitch || (live ? details.data?.modelSwitches?.pending?.[agent] : null);
    const initials = agent === state.coordinator ? 'PO' : (metadata.name.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('vi-VN');
    return `<article role="button" tabindex="0" data-agent="${escape(agent)}" aria-pressed="${selectedAgent === agent}" aria-label="Chi tiết ${escape(metadata.name)}" title="${escape(metadata.name + ': ' + (info.task || info.text || metadata.role))}" class="acard ${busy ? 'busy' : ''} ${busy && info.stalled ? 'stalled' : ''} ${attention ? 'attention' : ''} ${['done','approved'].includes(info.status) ? 'finished' : ''} ${selectedAgent === agent ? 'selected' : ''}" style="--c:${metadata.color}"><span class="agent-avatar">${initials}</span><div class="agent-row-body"><b>${escape(metadata.name)}</b><div class="agent-meta"><span class="st"><i class="status-dot"></i>${escape(pending ? 'Đang bàn giao model' : busy && info.stalled ? 'Chờ model lâu' : R.STATUS[info.status] || 'chờ')}</span><span class="agent-model" title="${escape(info.model)}">${escape(info.model || 'Chưa chọn model')}</span></div></div></article>`;
  }).join('') || '<p class="empty">PO sẽ đề xuất các vị trí sau khi nhận mục tiêu.</p>';
  element('agents').scrollTop = scroll;
}
function render() {
  element('welcome').hidden = !!runId;
  element('session-summary').textContent = state.title;
  renderRoster(); renderSessionSummary();
  element('scrub').max = events.length;
  element('scrub').value = cursor;
  element('position').textContent = `${cursor} / ${events.length} · ${time(events[cursor - 1]?.ts)}`;
  renderView(); renderAgentDetail();
}

function eventHtml(event) {
  const metadata = meta(event.agent);
  if (event.type === 'session') return `<article class="ev"><span class="t">${time(event.ts)}</span><div>Session: ${escape(event.title)}</div></article>`;
  return `<article class="ev" style="--c:${metadata.color}"><span class="t">${time(event.ts)}</span><div><span class="who">${escape(metadata.short)}</span> ${LABELS[event.type] || escape(event.type)}${event.to ? ' → ' + escape(meta(event.to).short) : ''}</div><div class="m">${escape(event.task || '')}${event.path ? ' ' + fileLink(event.path) : ''}${event.text ? '<div>' + escape(event.text) + '</div>' : ''}</div></article>`;
}
function renderBoard() {
  const columns = [['assigned','Chờ thực hiện'],['working','Đang làm'],['review','Chờ PO kiểm tra'],['approved','Đã duyệt'],['error','Cần xử lý']];
  const tasks = taskOutputs(), byId = new Map(tasks.map(task => [task.id, task]));
  const rootErrors = task => {
    const seen = new Set(), roots = new Set();
    function visit(item) {
      if (!item || seen.has(item.id)) return; seen.add(item.id);
      if (['failed','error','stopped','rework'].includes(item.status)) { roots.add(item.id); return; }
      for (const id of item.dependsOn || []) visit(byId.get(id));
    }
    visit(task); return roots;
  };
  const blocked = tasks.filter(task => task.status === 'blocked');
  const group = status => ['done','review'].includes(status) ? 'review' : ['error','failed','blocked','rework','stopped'].includes(status) ? 'error' : status === 'working' ? 'working' : status === 'approved' ? 'approved' : 'assigned';
  element('board').innerHTML = '<div class="board">' + columns.map(([key,title]) => {
    const items = tasks.filter(task => group(task.status) === key && !(key === 'error' && task.status === 'blocked' && rootErrors(task).size));
    return `<section class="col ${key === 'error' && items.length ? 'attention' : ''}"><h3>${title}<span>${items.length}${key === 'error' && blocked.length ? ' + ' + blocked.length + ' chờ' : ''}</span></h3><div class="list">${items.map(task => {
      const waiting = blocked.filter(item => item.id !== task.id && rootErrors(item).has(task.id));
      return `<article class="tcard" style="--c:${meta(task.agent).color}"><button class="task-agent ta" data-agent="${escape(task.agent)}">${escape(meta(task.agent).name)}</button><div class="tt">${escape(task.title)}</div><div class="tm">${escape(task.result?.diagnostic?.message || task.result?.error || task.note || statusLabel(task.status) || (task.dependsOn?.length ? 'Chờ việc phụ thuộc' : 'Sẵn sàng nhận việc'))}</div>${deadlineLabel(task)}<div class="files">${(task.result?.files || []).map(file => fileLink(file.path)).join('') || (task.files || []).map(fileLink).join('')}</div>${waiting.length ? `<details class="blocked-tree"><summary>${waiting.length} việc chờ lỗi này được phục hồi</summary>${waiting.map(item => `<p>${escape(item.title)}<br><span class="small">Tự mở lại khi task gốc hoàn tất</span></p>`).join('')}</details>` : ''}</article>`;
    }).join('') || '<div class="empty">Chưa có việc</div>'}</div></section>`;
  }).join('') + '</div>';
}

function timeline() {
  const start = state.startedAt;
  const end = Math.max(state.lastTs, start + 1000);
  const width = 1000;
  const left = 205;
  const area = 740;
  const x = stamp => left + Math.max(0, (stamp - start) / (end - start)) * area;
  let svg = `<svg role="img" aria-label="Thời gian thực hiện và review từng việc" viewBox="0 0 ${width} ${95 + state.tasks.length * 61}" style="min-width:700px;width:100%">`;
  for (let index = 0; index <= 5; index++) {
    const value = start + (end - start) * index / 5;
    svg += `<line x1="${x(value)}" y1="26" x2="${x(value)}" y2="${65 + state.tasks.length * 61}" stroke="var(--line)"/><text class="dim" x="${x(value)}" y="18" text-anchor="middle">${time(value)}</text>`;
  }
  state.tasks.forEach((task, index) => {
    const ypos = 60 + index * 61;
    const begin = task.startTs || task.assignTs;
    const done = task.endTs || end;
    const color = meta(task.agent).color;
    svg += `<text x="0" y="${ypos - 2}" style="fill:${color}">${escape(meta(task.agent).short)}</text><text x="0" y="${ypos + 15}">${escape(short(task.title, 28))}</text><rect class="bar" rx="5" x="${x(begin)}" y="${ypos - 10}" width="${Math.max(4, x(done) - x(begin))}" height="20" fill="${color}"><title>${escape(task.title)} · ${duration(Math.max(0, done - begin))}</title></rect>`;
    if (task.reviewTs) {
      const reviewed = task.approvedTs || end;
      svg += `<rect rx="4" x="${x(task.reviewTs)}" y="${ypos + 14}" width="${Math.max(4, x(reviewed) - x(task.reviewTs))}" height="7" fill="#a46bff"><title>Review</title></rect>`;
    }
    if (task.approvedTs) svg += `<circle cx="${x(task.approvedTs)}" cy="${ypos + 17}" r="5" fill="#3ddc84"/>`;
  });
  svg += '</svg>';
  element('timeline').innerHTML = '<div class="legend"><span>Thanh màu: thời gian làm</span><span><i style="background:var(--opus)"></i>Review</span><span><i style="background:var(--ok)"></i>Duyệt</span></div>' + (state.tasks.length ? svg : '<div class="empty">Chưa có việc để hiển thị</div>');
}
function graph() {
  const folders = Object.keys(state.folders);
  const workers = agentIds().filter(id => id !== state.coordinator);
  const height = Math.max(440, folders.length * 82 + 60, workers.length * 110);
  const positions = { [state.coordinator]: [130, height / 2] };
  workers.forEach((id, index) => { positions[id] = [400, (index + 1) * height / (workers.length + 1)]; });
  folders.forEach((key, index) => { positions['folder:' + key] = [745, (index + 1) * height / (folders.length + 1)]; });
  let svg = `<svg role="img" aria-label="Sơ đồ giao việc giữa agent và thư mục" viewBox="0 0 960 ${height}" style="width:100%;height:calc(100% - 30px);min-height:250px">`;
  for (const link of Object.values(state.links)) {
    const from = positions[link.from], to = positions[link.to];
    if (!from || !to) continue;
    const color = link.kind === 'done' ? '#3ddc84' : link.kind === 'rework' ? '#ff5c6c' : meta(link.from).color;
    const offset = link.kind === 'done' ? 28 : link.kind === 'rework' ? -25 : 0;
    const middle = (from[0] + to[0]) / 2;
    svg += `<path class="${!state.ended && live && link.kind === 'edit' ? 'flow' : ''}" d="M ${from[0]} ${from[1]} C ${middle} ${from[1] + offset}, ${middle} ${to[1] + offset}, ${to[0]} ${to[1]}" stroke="${color}" opacity=".55" stroke-width="${Math.min(5, 1 + link.count)}" fill="none"><title>${link.kind} ×${link.count}</title></path>`;
  }
  for (const agent of agentIds()) {
    const [xpos, ypos] = positions[agent];
    const metadata = meta(agent);
    svg += `<circle cx="${xpos}" cy="${ypos}" r="42" fill="var(--card)" stroke="${metadata.color}" stroke-width="2"/><text x="${xpos}" y="${ypos + 4}" text-anchor="middle" style="fill:${metadata.color};font-weight:600">${escape(metadata.short)}</text><text class="dim" x="${xpos}" y="${ypos + 65}" text-anchor="middle">${R.STATUS[state.agents[agent].status]}</text>`;
  }
  for (const key of folders) {
    const [xpos, ypos] = positions['folder:' + key];
    svg += `<g><rect x="${xpos - 85}" y="${ypos - 23}" width="170" height="46" rx="8" fill="var(--card)" stroke="var(--line)"/><text x="${xpos}" y="${ypos - 1}" text-anchor="middle">${escape(short(key, 25))}</text><text class="dim" x="${xpos}" y="${ypos + 15}" text-anchor="middle">${state.folders[key].count} lượt sửa file</text></g>`;
  }
  element('graph').innerHTML = '<div class="legend"><span>Màu agent: giao việc / sửa file</span><span style="color:var(--ok)">Xanh lá: trả kết quả</span><span style="color:var(--err)">Đỏ: yêu cầu sửa</span></div>' + svg + '</svg>';
}
function rows(items, max) {
  return items.map(item => `<div class="row" style="--c:${item.color}"><span class="nm ${item.path ? 'file' : ''}" ${item.path ? `data-file="${escape(item.path)}"` : ''} title="${escape(item.name)}">${escape(item.name)}</span><div class="bar"><i style="width:${Math.max(1, item.value / Math.max(1, max) * 100)}%"></i></div><span class="v">${item.value}</span></div>`).join('');
}
function stats() { resources(); }
function renderCollaboration() {
  const current = details.runId === runId ? details : {}, data = current.data || {};
  const collaboration = data.collaboration || {}, decisions = collaboration.decisions || [], messages = collaboration.messages || [];
  const pending = decisions.filter(item => item.status === 'pending');
  element('decision-count').textContent = pending.length ? pending.length + ' cần chọn' : '';
  element('chat-shortcut').disabled = !data.request;
  element('po-chat-send').disabled = !data.request || controlSending.has(runId + ':chatPO');
  element('po-chat-hint').textContent = data.holdReason || (current.live && ['planning', 'running', 'reviewing'].includes(data.phase) ? 'PO trả lời ngay. Yêu cầu đổi việc được áp dụng ở mốc tiếp theo, không ngắt việc đang chạy.' : data.phase === 'paused' ? 'Trao đổi vẫn giữ trạng thái tạm dừng. Bấm Tiếp tục khi sẵn sàng chạy.' : 'PO trả lời và cập nhật plan tại đây. Giữ cùng session và kết quả đã xong.');
  const signature = JSON.stringify([runId, collaboration]);
  if (signature === chatSignature) return;
  chatSignature = signature;
  element('ceo-decisions').innerHTML = pending.length ? '<h3>Cần bạn quyết định</h3>' + pending.map(item => `<article class="decision-card"><h4>${escape(item.question)}</h4><p>${escape(item.reason)}</p><span class="small">${item.blocking ? 'Chờ bạn chọn trước khi giao việc tiếp' : 'PO có thể tiếp tục phần độc lập'}</span><div class="decision-options">${item.options.map((option, index) => `<button class="quiet" data-decision="${escape(item.id)}" data-choice-index="${index}">${escape(option)}</button>`).join('')}<button class="quiet decision-other-toggle" data-decision-other="${escape(item.id)}" aria-expanded="false">Khác… (tự nhập lựa chọn)</button><div class="decision-other" data-other-box="${escape(item.id)}" hidden><textarea rows="2" maxlength="2000" data-other-input="${escape(item.id)}" placeholder="Nhập lựa chọn của bạn cho PO…"></textarea><button class="primary" data-decision-custom="${escape(item.id)}">Gửi lựa chọn này</button></div></div></article>`).join('') : '';
  if (pending.length) requestAnimationFrame(() => element('ceo-decisions').scrollIntoView({ block: 'nearest' }));
  const area = element('po-messages'), wasBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 70;
  area.innerHTML = (data.request ? `<article class="chat-message user goal"><span class="chat-avatar" aria-hidden="true">CEO</span><div class="chat-bubble"><div class="chat-meta"><b>Mục tiêu ban đầu</b></div><div class="chat-body"><p>${escape(data.request)}</p></div></div></article>` : '') + messages.map(item => `<article class="chat-message ${item.role === 'user' ? 'user' : 'assistant'}"><span class="chat-avatar" aria-hidden="true">${item.role === 'user' ? 'CEO' : 'PO'}</span><div class="chat-bubble"><div class="chat-meta"><b>${item.role === 'user' ? 'Bạn (CEO)' : 'PO'}</b>${item.role === 'user' ? '' : '<span class="chat-model">' + escape(item.model || '') + '</span>'}<span>${time(item.createdAt)}</span>${item.role === 'user' ? receipt(item) : ''}</div><div class="chat-body">${item.role === 'user' ? '<p>' + escape(item.text) + '</p>' : markdown(item.text)}</div>${(item.attachments || []).length ? `<div class="msg-attachments">${item.attachments.map(file => file.type === 'image' ? (file.previewUrl ? `<img src="${escape(file.previewUrl)}" alt="${escape(file.name)}" title="${escape(file.name)}">` : `<span class="attach-chip">🖼 ${escape(file.name)}</span>`) : `<span class="attach-chip" title="${escape(file.path || '')}">${file.type === 'folder' ? '📁' : '📎'} ${escape(file.relative || file.name)}</span>`).join('')}</div>` : ''}${item.error ? `<p class="notice">${escape(item.error)}</p><button class="quiet" data-retry-message="${escape(item.id)}">Gửi lại tin này</button>` : ''}</div></article>`).join('') || '<p class="empty">Giao mục tiêu trước để trao đổi với PO.</p>';
  const thinking = messages.find(item => item.role === 'user' && item.status === 'answering');
  if (thinking) area.insertAdjacentHTML('beforeend', `<article class="chat-message assistant typing" aria-live="polite"><span class="chat-avatar" aria-hidden="true">PO</span><div class="chat-bubble"><div class="chat-meta"><b>PO</b><span class="chat-model">${escape(data.coordinator || '')}</span><span>từ ${time(thinking.readAt || thinking.createdAt)}</span></div><p><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>PO đang đọc trạng thái team và soạn trả lời…</p></div></article>`);
  if (wasBottom || thinking) area.scrollTop = area.scrollHeight;
}
function receipt(item) {
  if (item.status === 'error') return ' · <span class="receipt error">Chưa xử lý được</span>';
  if (item.status === 'answering') return ' · <span class="receipt read">✓✓ Đã xem · đang soạn…</span>';
  if (item.status === 'processed') return ' · <span class="receipt read">✓✓ Đã trả lời</span>';
  if (item.quickReplied) return ' · <span class="receipt read">✓✓ Đã trả lời · áp dụng ở mốc tiếp theo</span>';
  return ' · <span class="receipt">✓ Đã gửi · chờ PO đọc</span>';
}
function renderConcept() {
  const data = details.runId === runId ? details.data || {} : {}, concept = data.concept;
  element('concept-shortcut').hidden = !concept;
  const signature = JSON.stringify([runId, concept, data.phase, conceptSending.has(runId), connection.models]);
  if (signature === conceptSignature) return;
  conceptSignature = signature;
  const waiting = data.phase === 'awaiting_concept', busy = conceptSending.has(runId) || details.live && !waiting;
  element('concept-content').innerHTML = concept ? `<p class="eyebrow">01 · HIỂU MỤC TIÊU</p><p class="output-text">${escape(concept.understanding)}</p><details><summary>Quan sát project & phần chưa rõ</summary><p class="output-text">${escape(concept.findings)}</p></details><p class="eyebrow">02 · HƯỚNG LÀM</p><p class="output-text">${escape(concept.recommendation)}</p>${concept.options.map((option,index) => `<article class="concept-card"><div class="result-heading"><h3>${index + 1}. ${escape(option.title)}</h3>${concept.approved?.optionId === option.id ? '<span class="chip">CEO đã duyệt</span>' : ''}</div><p>${escape(option.rationale)}</p><p class="small">Dự kiến ${option.estimate.minMinutes}–${option.estimate.maxMinutes} phút làm việc · Độ chắc chắn ${escape({low:'thấp',medium:'vừa',high:'cao'}[option.estimate.confidence])}</p><p class="small">${escape(option.estimate.basis)}</p><h4>Demo trải nghiệm</h4><p class="output-text">${escape(option.experience)}</p>${option.preview?.previewUrl ? `<button class="asset-preview" data-image-action="open" data-artifact="${escape(option.preview.artifact)}"><img src="${escape(option.preview.previewUrl)}" alt="Ảnh minh họa ${escape(option.title)}"></button><p class="small">Ảnh concept minh họa · ${escape(option.preview.model)} · Chưa phải game chạy thật</p>` : option.preview?.status === 'generating' ? '<p class="small">Đang tạo ảnh demo…</p>' : option.preview?.error ? `<p class="notice">Ảnh demo chưa tạo được: ${escape(option.preview.error)}. Bạn vẫn có thể duyệt hướng.</p>` : '<p class="small">Chưa tạo ảnh demo. Có thể tạo bằng model ảnh từ proxy.</p>'}<h4>Kết quả dự kiến</h4><ul>${option.deliverables.map(item => `<li>${escape(item)}</li>`).join('')}</ul><details><summary>Giả định & rủi ro</summary><ul>${[...option.assumptions,...option.risks].map(item => `<li>${escape(item)}</li>`).join('')}</ul></details>${waiting ? `<div class="concept-actions"><button class="quiet" data-concept-preview="${escape(option.id)}" ${busy || !connection.models.some(model => imageModel(model.id)) ? 'disabled' : ''}>Tạo ảnh demo</button><button class="primary" data-concept-approve="${escape(option.id)}" ${busy ? 'disabled' : ''}>Duyệt hướng này & chia việc</button></div>` : ''}</article>`).join('')}<p class="small">Ước tính chưa bao gồm thời gian chờ bạn duyệt. PO tính lịch chi tiết sau khi chia task, cập nhật ETA khi phát sinh lỗi hoặc thay đổi phạm vi.</p><button class="quiet" data-panel="chat">Trao đổi / yêu cầu sửa đề xuất</button>` : '<p class="empty">PO sẽ trình bày đề xuất trước khi chia team.</p>';
}
function inlineMd(text) {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
function markdown(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
  let list = null, code = null;
  const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (code) { out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>'); code = null; } else { close(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    let m;
    if ((m = /^\s*(#{1,4})\s+(.*)$/.exec(line))) { close(); out.push('<h' + Math.min(6, m[1].length + 3) + ' class="md-h">' + inlineMd(m[2]) + '</h' + Math.min(6, m[1].length + 3) + '>'); continue; }
    if ((m = /^\*\*([^*]+)\*\*:?\s*$/.exec(line.trim()))) { close(); out.push('<h5 class="md-h">' + inlineMd(m[1]) + '</h5>'); continue; }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li value="' + m[1] + '">' + inlineMd(m[2]) + '</li>'); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inlineMd(m[1]) + '</li>'); continue; }
    if ((m = /^\s*(?:→|->|=>)\s*(.*)$/.exec(line))) { const item = '<div class="md-action">→ ' + inlineMd(m[1]) + '</div>'; if (list) { const last = out.length - 1; out[last] = out[last].replace(/<\/li>$/, item + '</li>'); } else out.push(item); continue; }
    if (!line.trim()) { close(); continue; }
    close(); out.push('<p>' + inlineMd(line) + '</p>');
  }
  if (code) out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
  close();
  return out.join('');
}
function deadlineLabel(task) {
  const entry = details.data?.schedule?.tasks?.[task.id];
  if (!entry) return '';
  const label = entry.startedAt || details.data?.schedule?.startedAt ? 'Hạn ' : 'Dự kiến ';
  return `<div class="small task-deadline ${entry.late || task.status === 'working' && Date.now() > Date.parse(entry.deadlineAt) ? 'late' : ''}">${entry.estimateMinutes || task.estimateMinutes || '—'} phút · ${label}${time(entry.deadlineAt)}${entry.actualMs != null ? ' · Thực tế ' + duration(entry.actualMs) : ''}</div>`;
}
function clock(ms) {
  const total = Math.ceil(Math.abs(ms) / 1000), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), sec = total % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function taskTiming(task) {
  const entry = details.data?.schedule?.tasks?.[task.id] || {};
  const estimateMs = (entry.estimateMinutes || task.estimateMinutes || 0) * 60000;
  const start = Date.parse(entry.startedAt || '') || null;
  const due = start && estimateMs ? Math.max(start + estimateMs, Date.parse(entry.deadlineAt || '') || 0) : Date.parse(entry.deadlineAt || '') || null;
  return { entry, estimateMs, start, due };
}
function roleProgressHtml(agent, tasks) {
  if (!tasks.length) return '';
  const finished = tasks.filter(task => ['done', 'approved'].includes(task.status)).length;
  const role = details.data?.schedule?.roles?.[agent];
  const roleDue = Math.max(0, Date.parse(role?.deadlineAt || '') || 0, ...tasks.map(task => taskTiming(task).due || 0)) || null;
  const rows = tasks.map(task => {
    const { entry, estimateMs, start, due } = taskTiming(task);
    const done = ['done', 'approved'].includes(task.status), working = task.status === 'working';
    const checks = task.result?.assessment?.checks || [];
    const passed = checks.filter(check => check.status === 'pass').length;
    const last = events.slice(0, cursor).filter(event => event.taskId === task.id && event.agent === agent).slice(-1)[0];
    const percent = done ? 100 : working && start && estimateMs ? Math.min(95, Math.round((Date.now() - start) / estimateMs * 100)) : 0;
    const timer = done ? '<span class="countdown done">Xong · ' + (entry.actualMs != null ? duration(entry.actualMs) : '—') + '</span>'
      : working && due ? '<span class="countdown" data-countdown="' + due + '" data-start="' + (start || '') + '" data-estimate="' + estimateMs + '">' + (due - Date.now() >= 0 ? 'Còn ' : 'Trễ ') + clock(due - Date.now()) + '</span>'
      : '<span class="countdown idle">' + escape(statusLabel(task.status) || (task.dependsOn?.length ? 'Chờ việc phụ thuộc' : 'Chưa bắt đầu')) + '</span>';
    return '<div class="progress-task ' + (done ? 'done' : working ? 'working' : '') + '"><div class="progress-head"><b>' + escape(task.title) + '</b>' + timer + '</div>'
      + '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><i style="width:' + percent + '%"></i></div>'
      + '<div class="small">Ước tính ' + (estimateMs ? Math.round(estimateMs / 60000) + ' phút' : '—') + (start ? ' · Bắt đầu ' + time(start) : '') + (due ? ' · Hạn ' + time(due) : '') + (checks.length ? ' · Nghiệm thu ' + passed + '/' + checks.length : (task.acceptance?.length ? ' · ' + task.acceptance.length + ' tiêu chí' : '')) + '</div>'
      + (last && !done ? '<div class="small progress-last">Đang: ' + escape(short(last.text || last.task || LABELS[last.type] || last.type, 140)) + ' · ' + time(last.ts) + '</div>' : '') + '</div>';
  }).join('');
  return '<section class="role-progress"><div class="progress-head"><h3>Tiến độ · ' + finished + '/' + tasks.length + ' việc</h3>' + (roleDue ? '<span class="small">Hạn vị trí ' + time(roleDue) + ' · ' + (role?.estimateMinutes || Math.round(tasks.reduce((sum, task) => sum + taskTiming(task).estimateMs, 0) / 60000) || '—') + ' phút</span>' : '') + '</div>'
    + '<div class="progress-bar total"><i style="width:' + Math.round(finished / tasks.length * 100) + '%"></i></div>' + rows + '</section>';
}
function updateTaskCountdowns() {
  for (const node of document.querySelectorAll('[data-countdown]')) {
    const left = Number(node.dataset.countdown) - Date.now();
    node.textContent = left >= 0 ? 'Còn ' + clock(left) : 'Trễ ' + clock(left);
    node.classList.toggle('late', left < 0);
    const start = Number(node.dataset.start), estimate = Number(node.dataset.estimate);
    const bar = node.closest('.progress-task')?.querySelector('.progress-bar i');
    if (bar && start && estimate) bar.style.width = Math.min(95, Math.round((Date.now() - start) / estimate * 100)) + '%';
  }
}
setInterval(updateTaskCountdowns, 1000);
function resources() {
  const current = details.runId === runId ? details.data || {} : {}, usage = current.usage || {}, summary = usage.summary || {}, rows = summary.models || [], config = usage.settings || {};
  const signature = JSON.stringify([runId, usage]);
  if (signature === resourceSignature) return;
  if (element('resource-config')?.contains(document.activeElement)) return;
  resourceSignature = signature;
  const area = element('stats'), previous = area.querySelector('#resource-config'), editing = previous?.contains(document.activeElement), values = previous ? Object.fromEntries(new FormData(previous)) : null, open = area.querySelector('details')?.open;
  area.innerHTML = `<div class="result-heading"><h2>Tài nguyên session</h2><span class="small">${summary.calls || 0} lượt gọi · ${summary.tokens || 0} token đã biết</span></div><p class="small">Token lấy từ usage của proxy. Lượt lỗi, retry hoặc thiếu usage có thể phát sinh thêm token/phí chưa đo được. Thời gian là tổng thời lượng các request, có thể chạy song song.</p><div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Vị trí / Model</th><th>Lượt / Retry / Lỗi</th><th>Input / Output</th><th>Thời gian</th><th>Chi phí ước tính</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(meta(row.agent).name)}<small>${escape(row.model)}</small></td><td>${row.calls} / ${row.retries} / ${row.failures}</td><td>${row.input} / ${row.output}${row.missingUsage ? `<small>${row.missingUsage} lượt thiếu usage đầy đủ</small>` : ''}${row.images ? `<small>${row.images} ảnh đã tạo</small>` : ''}</td><td>${duration(row.durationMs)}</td><td>${row.unpriced === row.calls ? 'Chưa có giá/usage' : Number(row.estimatedCost).toFixed(5) + ' ' + escape(config.currency || 'USD')}${row.unpriced ? '<small>Còn lượt chưa tính giá</small>' : ''}</td></tr>`).join('') || '<tr><td colspan="5">Chưa có lượt gọi được ghi nhận. Session cũ không có số liệu hồi tố.</td></tr>'}</tbody></table></div><details class="resource-settings"><summary>Ngân sách & bảng giá</summary><form id="resource-config"><div class="budget-grid"><label>Giới hạn lượt gọi<input name="maxCalls" type="number" min="0" step="1" value="${config.maxCalls || 0}"></label><label>Giới hạn token đã biết<input name="maxTokens" type="number" min="0" step="1" value="${config.maxTokens || 0}"></label><label>Đơn vị tiền<input name="currency" maxlength="12" value="${escape(config.currency || 'USD')}"></label></div><p class="small">0 = không giới hạn. Khi chạm giới hạn, team hoàn tất request đang chạy và tạm dừng cùng session. Token chỉ kiểm soát theo số đã biết; đây không phải trần phí thanh toán.</p><label>Bảng giá JSON theo đúng ID model<textarea name="prices" rows="7" spellcheck="false" placeholder='{"model-id":{"input":0,"output":0,"cached":0,"image":0}}'>${escape(JSON.stringify(config.prices || {}, null, 2))}</textarea></label><p class="small">input/output/cached: giá mỗi 1 triệu token; image: giá mỗi ảnh. Nhập giá thực tế từ proxy. Bỏ trống model chưa có giá.</p><button class="primary" type="submit" ${!current.request ? 'disabled' : ''}>Lưu cho session</button><p id="budget-feedback" role="status" class="small"></p></form></details>`;
  if (open) area.querySelector('details').open = true;
  if (editing && values) for (const [key, value] of Object.entries(values)) area.querySelector(`[name="${key}"]`).value = value;
  element('resource-config').onsubmit = event => {
    event.preventDefault();
    try {
      const form = new FormData(event.target), settings = { maxCalls: Number(form.get('maxCalls')), maxTokens: Number(form.get('maxTokens')), currency: form.get('currency'), prices: JSON.parse(form.get('prices') || '{}') };
      vscode.postMessage({ type: 'sessionBudget', runId, settings }); element('budget-feedback').textContent = 'Đang lưu…';
    } catch { element('budget-feedback').textContent = 'JSON bảng giá chưa hợp lệ.'; }
  };
}
function deliveryHtml(data) {
  const delivery = data?.delivery;
  if (!delivery) return '';
  return `<section class="delivery-summary"><div class="result-heading"><h3>Bàn giao cho CEO</h3><span class="chip">${data.reportOutdated ? 'Cần cập nhật sau yêu cầu mới' : data.approved === true ? 'PO đã duyệt' : 'Đang hoàn thiện'}</span></div>${delivery.summary ? `<p class="output-text">${escape(delivery.summary)}</p>` : ''}<div class="delivery-grid"><div><h4>File / scene</h4>${delivery.files.map(file => `<p>${fileLink(file.path)} <span class="small">${file.state === 'applied' ? 'Đã áp dụng' : 'Đề xuất, chưa áp dụng'}</span></p>`).join('') || '<p class="small">Chưa có file.</p>'}<p class="small">${delivery.images.length} ảnh đã tạo · Preview trong kết quả từng task. Việc import cần xác minh riêng.</p></div><div><h4>Đã xác minh bằng công cụ</h4>${delivery.verified.map(check => `<p>✓ ${escape(check.description)}</p>`).join('') || '<p class="small">Chưa có bằng chứng công cụ xác nhận tiêu chí. Báo cáo phân tích không được tính là test đã chạy.</p>'}</div></div>${delivery.incomplete.length ? `<details><summary>Chưa hoàn tất · ${delivery.incomplete.length}</summary>${delivery.incomplete.map(item => `<p><b>${escape(item.title)}</b><br>${escape(item.detail)}</p>`).join('')}</details>` : ''}<p class="small">${escape(delivery.nextAction)}</p>${data.schedule?.actualMs != null ? `<p class="small">Thời gian hoạt động đã ghi: ${duration(data.schedule.actualMs)}${data.schedule.incompleteTiming ? ' · Có gián đoạn; không tính thời gian mất dấu' : ''}. Mốc dự kiến ban đầu: ${time(data.schedule.originalFinishAt)}.</p>` : ''}<button class="quiet" data-panel="chat">Trao đổi tiếp với PO</button></section>`;
}
function taskOutputs() {
  if (live && details.runId === runId && details.data?.plan) return details.data.plan.tasks.map(task => {
    const status = details.data.status?.[task.id];
    return { ...task, agent: task.roleId, status: status === 'done' && details.data.approved === true ? 'approved' : status, result: details.data.results?.[task.id] };
  });
  return state.tasks.map(task => ({ ...task, instruction: '', scope: task.path ? [task.path] : [], result: task.result ? { summary: task.result, files: (task.proposedPaths || []).map(path => ({ path })) } : null }));
}
function outputHtml(task) {
  const result = task.result;
  const checks = result?.assessment?.checks || (task.acceptance || []).map(item => ({ ...item, status: 'waiting', evidence: [] }));
  const checklist = checks.length ? `<details class="acceptance-report"><summary>Nghiệm thu · ${checks.filter(check => check.status === 'pass').length}/${checks.length} có bằng chứng</summary>${checks.map(check => `<div class="acceptance-check ${escape(check.status)}"><b>${check.status === 'pass' ? '✓' : check.status === 'fail' ? '✕' : '○'} ${escape(check.description || check.id)}</b><span class="small">${escape(check.verification)} · ${escape(check.status)}</span>${(check.evidence || []).map(item => `<p>${escape(item.detail)} ${item.path ? fileLink(item.path) : ''}</p>`).join('')}${check.note ? `<p class="small">${escape(check.note)}</p>` : ''}</div>`).join('')}</details>` : '';
  const images = live && details.runId === runId ? (details.images || []).filter(image => image.taskId === task.id) : [];
  const gallery = images.length ? `<div class="asset-gallery">${images.map(image => `<article class="asset-card"><button class="asset-preview" data-image-action="open" data-artifact="${escape(image.artifact)}" aria-label="Xem ảnh ${escape(image.path)}"><img loading="lazy" src="${escape(image.previewUrl)}" alt="${escape(image.path)}"></button><b>${escape(R.baseName(image.path))}</b><p class="small">${image.width} × ${image.height} · ${escape(image.model)} · Chưa tự import</p><button class="quiet" data-image-action="save" data-artifact="${escape(image.artifact)}">Lưu vào project</button><details><summary>Prompt ảnh</summary><p class="output-text">${escape(image.prompt)}</p></details></article>`).join('')}</div>` : '';
  return `<details class="output-task" data-fold-key="${escape(runId + ':' + task.agent + ':' + task.id)}"><summary>${escape(task.title)} <span class="small">${escape(meta(task.agent).name)} · ${escape(statusLabel(task.status))}</span></summary>${task.instruction ? `<p>${escape(task.instruction)}</p>` : ''}${result?.error ? `<p class="notice">${escape(result.error)}</p>` : ''}<div class="output-text">${escape(result?.summary || (!result?.error ? 'Chưa có kết quả cho việc này.' : ''))}</div>${checklist}<div class="files">${(result?.files || []).map(file => fileLink(file.path)).join('')}</div>${gallery}</details>`;
}
function renderLog() {
  const mode = element('log-filter').value, query = element('log-search').value.toLowerCase();
  const tech = new Set((details.data?.plan?.roles || []).filter(role => role.kind === 'tech').map(role => role.id));
  const visible = events.slice(0, live ? events.length : cursor).filter(event => (mode !== 'errors' || ['error', 'rework', 'stopped'].includes(event.type)) && (mode !== 'tech' || tech.has(event.agent) || tech.has(event.to)) && (!query || JSON.stringify(event).toLowerCase().includes(query)));
  const area = element('log-lines');
  const scroll = area.scrollTop;
  area.innerHTML = visible.slice(-2000).map(event => `<div class="log-line ${escape(event.type)}"><span class="log-time">${time(event.ts)}</span><span class="log-agent">${escape(meta(event.agent).name)}${event.to ? ' → ' + escape(meta(event.to).name) : ''}<small>${escape(event.model || '')}</small></span><span class="log-event">${escape(LABELS[event.type] || event.type)}${event.taskId ? ' · ' + escape(event.taskId) : ''}</span><pre>${escape(event.text || event.task || event.path || '')}</pre></div>`).join('') || '<p class="empty">Chưa có dòng log phù hợp.</p>';
  element('log-count').textContent = visible.length + ' dòng · hiển thị tối đa 2000 dòng mới nhất';
  area.scrollTop = element('log-follow').checked ? area.scrollHeight : scroll;
}
function renderResults() {
  const current = details.runId === runId ? details : {};
  const report = live ? current.report : '';
  const tasks = taskOutputs();
  element('results').innerHTML = `<div class="result-heading"><h2>Kết quả</h2><button class="quiet" data-command="openReport">Mở báo cáo</button></div>${live ? deliveryHtml(current.data) : ''}${live && !current.live && current.data && ['running', 'planning', 'reviewing'].includes(current.data.phase) ? '<p class="notice">Phiên trước đã ngắt. Bấm Tiếp tục để làm phần còn lại trong session này.</p>' : ''}${live && current.data?.error ? `<p class="notice">${escape(current.data.error)}</p>` : ''}${report ? `<details class="report" open><summary>Báo cáo tổng hợp & review</summary><pre>${escape(report)}</pre></details>` : '<p class="small">Kết quả từng vị trí xuất hiện khi model trả lời. Báo cáo tổng hợp được lưu sau bước review.</p>'}<div class="output-list">${tasks.map(outputHtml).join('') || '<p class="empty">Chưa có kết quả. Mở Yêu cầu để giao mục tiêu cho PO.</p>'}</div>`;
}
function showAgent(id) {
  if (!state.agents[id]) return;
  layout.close();
  if (window.innerWidth <= 760) layout.collapseSidebar();
  layout.open('detail');
  selectedAgent = id; renderRoster(); renderAgentDetail();
}
function renderAgentDetail() {
  const panel = element('agent-detail');
  const info = state.agents[selectedAgent];
  panel.hidden = !selectedAgent || !info;
  if (panel.hidden) return;
  const scroll = selectedAgent === panel.dataset.selectedRole ? panel.querySelector('.agent-content')?.scrollTop || 0 : 0;
  panel.dataset.selectedRole = selectedAgent;
  const current = details.runId === runId ? details : {};
  const role = current.data?.plan?.roles.find(role => role.id === selectedAgent);
  const currentModel = selectedAgent === 'lead' ? current.data?.coordinator : role?.model;
  const pendingSwitch = info.modelSwitch || (live && current.data?.modelSwitches?.pending?.[selectedAgent]);
  const modelKey = runId + ':' + selectedAgent;
  const activeSelect = element('agent-model');
  if (activeSelect && document.activeElement === activeSelect && activeSelect.dataset.agentKey === modelKey && activeSelect.dataset.currentModel === currentModel && !pendingSwitch && !modelSending.has(modelKey)) return;
  const canChange = live && !!currentModel && connection.models.length && (selectedAgent === 'lead' || role);
  const canStop = live && current.live && ['ready', 'running', 'planning', 'reviewing'].includes(current.data?.phase) && !current.data?.stoppedAgents?.includes(selectedAgent) && (selectedAgent === state.coordinator || ['ready', 'running'].includes(current.data?.phase));
  const tasks = taskOutputs().filter(task => task.agent === selectedAgent);
  panel.innerHTML = `<button id="detail-toggle" class="quiet" aria-label="Thu gọn chi tiết model">›</button><div class="agent-content"><div class="detail-title"><div class="result-heading"><h2>${escape(meta(selectedAgent).name)}</h2><button id="close-agent" class="icon-button" aria-label="Đóng chi tiết">${icon('close')}</button></div><div class="model-detail">${escape(info.model || currentModel)}</div><div class="detail-status"><i class="status-dot"></i>${escape(pendingSwitch ? 'Đang bàn giao model' : statusLabel(info.status))}<span>· ${time(info.lastTs)}</span></div></div><p class="detail-responsibility">${escape(role?.responsibility || meta(selectedAgent).role)}</p><p class="detail-current">${escape(info.task || info.text || 'Chưa có việc đang thực hiện.')}</p>${canChange ? `<details id="model-section" class="detail-section" data-fold-key="${escape(modelKey + ':model')}"><summary>Đổi model${pendingSwitch ? ' · Đang bàn giao' : ''}</summary><div id="model-controls"></div></details>` : ''}${roleProgressHtml(selectedAgent, tasks)}<h3>Việc & kết quả${tasks.length ? ' · ' + tasks.length : ''}</h3>${tasks.map(outputHtml).join('') || '<p class="small">PO phân tích, chia việc và kiểm tra kết quả tổng hợp.</p>'}<details class="activity-details" data-fold-key="${escape(modelKey + ':activity')}"><summary>Nhật ký vị trí</summary><p class="small">Tool, file, kết quả và lỗi đã ghi nhận.</p><div>${events.slice(0, cursor).filter(event => event.agent === selectedAgent || event.to === selectedAgent).slice(-40).reverse().map(eventHtml).join('')}</div></details>${canStop ? `<details class="detail-stop detail-section" data-fold-key="${escape(modelKey + ':stop')}"><summary>Dừng vị trí</summary><p class="small">${selectedAgent === state.coordinator ? 'Dừng PO sẽ hủy các request của cả team trong lượt này.' : 'Hủy request và các việc chưa chạy của vị trí này. Việc phụ thuộc sẽ bị chặn.'}</p><button id="stop-agent" class="danger">${selectedAgent === state.coordinator ? 'Dừng PO và cả team' : 'Dừng riêng vị trí này'}</button></details>` : ''}</div>`;
  if (canChange) {
    const box = document.createElement('section'); box.className = 'model-change';
    box.innerHTML = `<label>Model cho vị trí này<select id="agent-model" aria-label="Đổi model vị trí"></select></label><button id="change-agent-model" class="primary">Đổi model</button><p class="small model-switch-notice" aria-live="polite"></p>`;
    element('model-controls').append(box);
    const select = element('agent-model'), button = element('change-agent-model');
    select.dataset.agentKey = modelKey; select.dataset.currentModel = currentModel;
    const options = connection.models.filter(model => imageModel(model.id) === imageModel(currentModel) && (selectedAgent !== 'lead' || !imageModel(model.id)));
    for (const model of options) { const option = document.createElement('option'); option.value = option.textContent = model.id; select.append(option); }
    select.value = pendingSwitch?.model || modelDrafts.get(modelKey) || currentModel;
    if (!select.value) select.value = currentModel;
    const update = () => { button.disabled = !!pendingSwitch || modelSending.has(modelKey) || !select.value || select.value === currentModel; };
    select.disabled = !!pendingSwitch || modelSending.has(modelKey);
    select.onchange = () => { modelDrafts.set(modelKey, select.value); update(); };
    button.onclick = () => {
      modelSending.add(modelKey); select.disabled = true; update();
      vscode.postMessage({ type: 'changeModel', runId, agent: selectedAgent, model: select.value, requestedAt: Date.now() });
    };
    const notice = box.querySelector('.model-switch-notice');
    if (pendingSwitch) { notice.dataset.switchDeadline = pendingSwitch.deadline; notice.dataset.switchModel = pendingSwitch.model; }
    else notice.textContent = 'Đang làm: hoàn tất phần hiện tại, tối đa 3 phút rồi tự đổi. Đang rảnh/lỗi: đổi ngay. Giữ cùng session.';
    update(); updateSwitchCountdown();
  }
  layout?.refresh();
  if (pendingSwitch && element('model-section')) element('model-section').open = true;
  panel.querySelector('.agent-content').scrollTop = scroll;
  element('close-agent').onclick = () => { selectedAgent = null; panel.hidden = true; renderRoster(); };
  if (element('stop-agent')) element('stop-agent').onclick = () => {
    element('stop-agent').disabled = true;
    vscode.postMessage({ type: 'stopAgent', runId, agent: selectedAgent });
  };
}
function updateSwitchCountdown() {
  for (const notice of document.querySelectorAll('[data-switch-deadline]')) {
    const remaining = Math.max(0, Math.ceil((Number(notice.dataset.switchDeadline) - Date.now()) / 1000));
    notice.textContent = `Đang bàn giao → ${notice.dataset.switchModel} · ${remaining ? 'còn tối đa ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0') : 'đang chuyển model…'}`;
  }
}
setInterval(updateSwitchCountdown, 1000);
function renderView() {
  renderCollaboration(); renderConcept();
  if (view === 'office') element('feed').innerHTML = events.slice(0, cursor).slice(-60).reverse().map(eventHtml).join('');
  if (view === 'board') renderBoard();
  if (view === 'timeline') timeline();
  if (view === 'graph') graph();
  if (view === 'stats') stats();
  if (view === 'results') renderResults();
  if (view === 'log') renderLog();
  layout?.refresh();
  vscode.postMessage({ type: 'rendered', view, events: cursor });
}
function closeMenus(except) {
  for (const menu of app.querySelectorAll('details.menu[open]')) if (menu !== except) menu.open = false;
}
app.addEventListener('inspector-open', () => { selectedAgent = null; element('agent-detail').hidden = true; renderRoster(); });
app.addEventListener('click', event => {
  const conceptApprove = event.target.closest('[data-concept-approve]'), conceptPreview = event.target.closest('[data-concept-preview]');
  if ((conceptApprove || conceptPreview) && !conceptSending.has(runId)) {
    conceptSending.add(runId);
    vscode.postMessage({ type: conceptApprove ? 'approveConcept' : 'conceptPreview', runId, optionId: conceptApprove?.dataset.conceptApprove || conceptPreview?.dataset.conceptPreview }); renderConcept();
  }
  const retryMessage = event.target.closest('[data-retry-message]');
  if (retryMessage) { retryMessage.disabled = true; vscode.postMessage({ type: 'retryPO', runId, messageId: retryMessage.dataset.retryMessage }); }
  const otherToggle = event.target.closest('[data-decision-other]');
  if (otherToggle) {
    const box = element('ceo-decisions').querySelector(`[data-other-box="${CSS.escape(otherToggle.dataset.decisionOther)}"]`);
    if (box) { box.hidden = !box.hidden; otherToggle.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) box.querySelector('textarea').focus(); }
  }
  const custom = event.target.closest('[data-decision-custom]');
  if (custom) {
    const id = custom.dataset.decisionCustom, input = element('ceo-decisions').querySelector(`[data-other-input="${CSS.escape(id)}"]`), text = input?.value.trim();
    if (!text) input?.focus();
    else if (!controlSending.has(runId + ':answerDecision')) {
      controlSending.add(runId + ':answerDecision');
      for (const button of element('ceo-decisions').querySelectorAll('button')) button.disabled = true;
      vscode.postMessage({ type: 'answerDecision', runId, decisionId: id, choice: text, custom: true });
    }
  }
  const decision = event.target.closest('[data-decision]');
  if (decision) {
    const item = details.data?.collaboration?.decisions?.find(item => item.id === decision.dataset.decision), choice = item?.options[Number(decision.dataset.choiceIndex)];
    if (choice && !controlSending.has(runId + ':answerDecision')) {
      controlSending.add(runId + ':answerDecision');
      for (const button of element('ceo-decisions').querySelectorAll('button')) button.disabled = true;
      vscode.postMessage({ type: 'answerDecision', runId, decisionId: item.id, choice });
    }
  }
  const image = event.target.closest('[data-image-action]');
  if (image) vscode.postMessage({ type: 'imageAction', action: image.dataset.imageAction, artifact: image.dataset.artifact, runId });
  const file = event.target.closest('[data-file]');
  const tab = event.target.closest('[data-view]');
  const agent = event.target.closest('[data-agent]');
  if (agent) showAgent(agent.dataset.agent);
  if (file?.dataset.file) vscode.postMessage({ type: 'openFile', path: file.dataset.file, runId });
  if (tab) chooseView(tab.dataset.view);
  const command = event.target.closest('[data-command]');
  if (command) vscode.postMessage({ type: 'proxyCommand', command: command.dataset.command });
  if (event.target.closest('.menu-popover button, [data-panel], [data-view]')) closeMenus();
  else {
    const menu = event.target.closest('details.menu');
    closeMenus(menu);
  }
});
app.addEventListener('keydown', event => {
  const card = event.target.closest('[data-agent]');
  if (card?.tagName === 'ARTICLE' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); showAgent(card.dataset.agent); }
  if (event.key === 'Escape') { selectedAgent = null; element('agent-detail').hidden = true; layout.close(); closeMenus(); renderRoster(); }
});
element('new-request').oninput = () => {
  if (runId) {
    composerDrafts.set(runId, element('new-request').value);
    vscode.postMessage({ type: 'sessionDraft', runId, text: element('new-request').value });
  }
};
element('log-search').oninput = renderLog;
element('log-filter').onchange = renderLog;
element('log-follow').onchange = renderLog;
element('new-session').onclick = () => vscode.postMessage({ type: 'proxyCommand', command: 'newSession' });
element('po-chat-input').oninput = () => { if (runId) chatDrafts.set(runId, element('po-chat-input').value); };
element('po-chat-form').onsubmit = event => {
  event.preventDefault();
  const text = element('po-chat-input').value.trim();
  if ((!text && !pendingAttachments.length) || !runId || controlSending.has(runId + ':chatPO')) return;
  controlSending.add(runId + ':chatPO'); sentTexts.set(runId, element('po-chat-input').value);
  element('control-feedback').textContent = 'Đang gửi…'; renderCollaboration();
  vscode.postMessage({ type: 'chatPO', runId, text, attachments: { images: pendingAttachments.filter(item => item.kind === 'image').map(({ name, dataUrl }) => ({ name, dataUrl })), paths: pendingAttachments.filter(item => item.kind !== 'image').map(item => item.path) } });
  pendingAttachments = []; renderAttachments();
};
let pendingAttachments = [];
function renderAttachments() {
  const box = element('chat-attachments'); box.hidden = !pendingAttachments.length;
  box.innerHTML = pendingAttachments.map((item, index) => `<span class="attach-chip ${item.kind}">${item.kind === 'image' ? `<img src="${escape(item.dataUrl)}" alt="">` : item.kind === 'folder' ? '📁' : '📎'}<span>${escape(item.name)}</span><button type="button" data-remove-attachment="${index}" aria-label="Bỏ ${escape(item.name)}">×</button></span>`).join('');
}
function addAttachments(items) {
  for (const item of items) if (pendingAttachments.length < 12) pendingAttachments.push(item);
  renderAttachments(); element('control-feedback').textContent = pendingAttachments.length ? pendingAttachments.length + ' đính kèm sẽ gửi cùng tin nhắn.' : '';
}
function readImage(file) {
  return new Promise((resolve, reject) => { if (file.size > 8 * 1024 * 1024) return reject(new Error(file.name + ' lớn hơn 8 MB')); const reader = new FileReader(); reader.onload = () => resolve({ kind: 'image', name: file.name || 'ảnh dán.png', dataUrl: reader.result }); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
async function takeFiles(files) {
  const images = [...files].filter(file => /^image\/(png|jpeg|webp|gif)$/.test(file.type));
  try { addAttachments(await Promise.all(images.map(readImage))); } catch (error) { element('control-feedback').textContent = error.message; }
  const others = [...files].filter(file => !images.includes(file));
  if (others.length) element('control-feedback').textContent = 'File/thư mục kéo thả: dùng nút 📎 File hoặc 📁 Thư mục để chọn (VS Code cần đường dẫn thật).';
}
element('po-chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); element('po-chat-form').requestSubmit(); } });
element('attach-toggle').onclick = event => { event.stopPropagation(); const menu = element('attach-menu'); menu.hidden = !menu.hidden; element('attach-toggle').setAttribute('aria-expanded', String(!menu.hidden)); };
document.addEventListener('click', event => { if (!event.target.closest('.attach-wrap')) { element('attach-menu').hidden = true; element('attach-toggle').setAttribute('aria-expanded', 'false'); } });
element('po-chat-input').addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); takeFiles(files); } });
element('chat-drop').addEventListener('dragover', event => { event.preventDefault(); element('chat-drop').classList.add('dragging'); });
element('chat-drop').addEventListener('dragleave', () => element('chat-drop').classList.remove('dragging'));
element('chat-drop').addEventListener('drop', event => { event.preventDefault(); element('chat-drop').classList.remove('dragging'); takeFiles(event.dataTransfer?.files || []); });
element('chat-drop').addEventListener('click', event => {
  const pick = event.target.closest('[data-attach]'); if (pick) { element('attach-menu').hidden = true; vscode.postMessage({ type: 'pickAttachment', kind: pick.dataset.attach }); }
  const remove = event.target.closest('[data-remove-attachment]'); if (remove) { pendingAttachments.splice(Number(remove.dataset.removeAttachment), 1); renderAttachments(); }
});
element('rename-session').onclick = () => vscode.postMessage({ type: 'proxyCommand', command: 'renameSession' });
element('new-team').onclick = () => {
  const task = element('new-request').value.trim();
  if (!task) { element('new-request').focus(); return; }
  const sessionId = details.runId === runId && details.data?.phase === 'new' ? runId : undefined;
  vscode.postMessage({ type: 'proxyCommand', command: 'startTeam', input: { task, sessionId, readWorkspace: element('read-workspace').checked } });
};
element('add-task').onclick = () => vscode.postMessage({ type: 'addWork', runId });
element('add-role').onclick = () => vscode.postMessage({ type: 'addWork', runId, newRole: true });
element('roles').addEventListener('change', () => {
  vscode.postMessage({ type: 'coordinator', model: element('coordinator').value });
});
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const keys = PRIMARY_VIEWS;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (keys.indexOf(view) + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length;
  chooseView(keys[index]); element('tab-' + keys[index]).focus();
});
element('runs').addEventListener('change', () => { stop(); vscode.postMessage({ type: 'select', runId: element('runs').value }); });
element('demo').onclick = element('welcome-demo').onclick = () => vscode.postMessage({ type: 'demo' });
element('reset-camera').onclick = () => office?.resetCamera();
element('live').onclick = () => { stop(); setLive(true); cursor = events.length; rebuild(); };
element('scrub').addEventListener('input', () => { stop(); setLive(false); cursor = Number(element('scrub').value); rebuild(); });
element('play').onclick = () => {
  if (playback) { stop(); return; }
  setLive(false);
  if (cursor >= events.length) { cursor = 0; rebuild(); }
  element('play').textContent = 'Ⅱ';
  playback = setInterval(() => {
    if (cursor >= events.length) { stop(); return; }
    const event = events[cursor++];
    R.apply(state, event); office?.update(state, event); render();
  }, Number(element('speed').value));
};
window.addEventListener('message', ({ data: message }) => {
  if (message.type === 'conceptResult') { conceptSending.delete(message.runId); renderConcept(); }
  if (message.type === 'attachmentsPicked') { addAttachments(message.files || []); return; }
  if (message.type === 'sessionControlResult') {
    controlSending.delete(message.runId + ':' + message.action);
    if (message.ok && message.action === 'chatPO' && chatDrafts.get(message.runId) === sentTexts.get(message.runId)) chatDrafts.set(message.runId, '');
    if (message.runId === runId) {
      element('po-chat-input').value = chatDrafts.get(runId) || '';
      element('control-feedback').textContent = message.error || '';
      if (element('budget-feedback')) element('budget-feedback').textContent = message.error || 'Đã lưu ngân sách cho session.';
      chatSignature = ''; renderCollaboration();
    }
  }
  if (message.type === 'config' && message.layout) layout.restore(message.layout);
  if (message.type === 'testNavigate') chooseView(message.view);
  if (message.type === 'connection') renderConnection(message);
  if (message.type === 'draftPlan') {
    const chosen = selections.get(message.runId);
    if (chosen && draft?.runId === message.runId) for (const role of message.plan?.roles || []) if (draft.plan?.roles.find(previous => previous.id === role.id)?.model !== role.model) chosen[role.id] = role.model;
    draft = message; renderPlan();
  }
  if (message.type === 'modelChangeResult') { modelSending.delete(message.runId + ':' + message.agent); renderAgentDetail(); }
  if (message.type === 'runDetails' && message.runId === runId) {
    if (details.runId !== runId) {
      element('new-request-fold').open = !message.data?.request;
      if (message.data?.phase === 'new') layout.open('composer');
    }
    if (!composerDrafts.has(runId)) { composerDrafts.set(runId, message.composerDraft || ''); element('new-request').value = message.composerDraft || ''; }
    if (message.data?.phase && message.data.phase !== 'new' && details.data?.phase === 'new') { composerDrafts.set(runId, ''); element('new-request').value = ''; }
    const showConcept = message.data?.phase === 'awaiting_concept' && details.data?.phase !== 'awaiting_concept';
    details = message; renderSource(); if (showConcept) layout.open('concept'); renderRoster(); renderAgentDetail(); renderView();
  }
  if (message.type === 'config' && !saved.view) chooseView(message.defaultView);
  if (message.type === 'runs') runOptions(message.runs);
  if (message.type === 'snapshot') {
    stop();
    const previous = runId;
    runId = message.run?.id || null;
    if (previous !== runId) { layout.close(); element('new-request').value = composerDrafts.get(runId) || ''; element('po-chat-input').value = chatDrafts.get(runId) || ''; element('control-feedback').textContent = ''; }
    if (details.runId !== runId) { details = { data: null, report: '' }; selectedAgent = null; renderSource(); }
    events = message.run?.events || [];
    cursor = events.length;
    setLive(true); runOptions(message.runs); rebuild(); persist();
  }
  if (message.type === 'events' && message.runId === runId) {
    for (const event of message.events) if (event.type === 'model_switch_applied') {
      modelDrafts.delete(runId + ':' + event.agent);
      const chosen = selections.get(runId); if (chosen && event.agent !== 'lead') chosen[event.agent] = event.nextModel;
    }
    events.push(...message.events);
    if (live) {
      for (const event of message.events) { R.apply(state, event); office?.update(state, event); }
      cursor = events.length;
    }
    render();
  }
});
layout = createLayout(app, saved.layout, value => { persist(); vscode.postMessage({ type: 'layoutSave', layout: value }); });
chooseView(view);
render();
vscode.postMessage({ type: 'ready' });
