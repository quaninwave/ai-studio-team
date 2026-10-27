// Presentation preferences only. Session/runtime state remains in the host.
export function createLayout(app, initial, changed) {
  const defaults = { sidebar: window.innerWidth > 760, feed: false, detail: true };
  const panes = { composer: 'composer-panel', concept: 'concept-panel', chat: 'chat-panel', plan: 'plan-panel', proxy: 'proxy-config', replay: 'replay-panel' };
  const names = { composer: ['Yêu cầu', 'Mục tiêu của bạn và brief gửi cho PO'], concept: ['Đề xuất của PO', 'Bạn duyệt hướng trước, PO mới phân công'], chat: ['Chat với PO', 'Trao đổi và quyết định trong cùng session'], plan: ['Kế hoạch & phân công', 'Vị trí, model và công việc trong session'], proxy: ['Proxy & model', 'Kết nối và model mặc định cho session mới'], replay: ['Phát lại hoạt động', 'Xem lại nhật ký theo thời gian'] };
  const targets = { sidebar: ['sidebar', 248, 220, 380], inspector: ['inspector', 480, 340, 720], feed: ['feed-panel', 290, 210, 600], detail: ['agent-detail', 420, 300, 720] };
  let prefs = normalize(initial), focusRestore = null, dragging = null;
  const get = id => document.getElementById(id);
  function normalize(value = {}) {
    const open = { ...defaults }, sizes = {}, folds = {};
    if (value?.version === 2) for (const key in defaults) if (typeof value.open?.[key] === 'boolean') open[key] = value.open[key];
    for (const [key, [, , min, max]] of Object.entries(targets)) if (Number.isFinite(value?.sizes?.[key])) sizes[key] = Math.min(max, Math.max(min, value.sizes[key]));
    for (const [key, flag] of Object.entries(value?.folds || {}).slice(-300)) if (typeof flag === 'boolean') folds[key] = flag;
    return { version: 2, open, sizes, folds, drawer: value?.version === 2 && panes[value.drawer] ? value.drawer : null };
  }
  function save() { changed(structuredClone(prefs)); }
  function setOpen(key, value) {
    focusRestore = null;
    if (key in panes) {
      prefs.drawer = value ? key : null;
      if (value) { app.dispatchEvent(new CustomEvent('inspector-open')); }
    } else if (key in defaults) prefs.open[key] = value;
    else return;
    apply(); save();
  }
  function apply() {
    app.classList.toggle('focus-layout', !!focusRestore);
    app.classList.toggle('sidebar-collapsed', !prefs.open.sidebar || !!focusRestore);
    get('sidebar-toggle').setAttribute('aria-expanded', String(prefs.open.sidebar && !focusRestore));
    get('sidebar-toggle').setAttribute('aria-label', prefs.open.sidebar && !focusRestore ? 'Thu gọn danh sách team' : 'Mở danh sách team');
    get('inspector').hidden = !prefs.drawer;
    get('inspector-backdrop').hidden = !prefs.drawer;
    for (const [key, id] of Object.entries(panes)) get(id).hidden = prefs.drawer !== key;
    if (prefs.drawer) {
      get('inspector-title').textContent = names[prefs.drawer][0];
      get('inspector-caption').textContent = names[prefs.drawer][1];
    }
    for (const button of app.querySelectorAll('[data-panel]')) { button.classList.toggle('active', prefs.drawer === button.dataset.panel); button.setAttribute('aria-expanded', String(prefs.drawer === button.dataset.panel)); }
    get('feed-panel').classList.toggle('folded', !prefs.open.feed);
    get('agent-detail').classList.toggle('folded', !prefs.open.detail);
    const feedButton = get('feed-toggle');
    feedButton.setAttribute('aria-expanded', String(prefs.open.feed));
    feedButton.textContent = (prefs.open.feed ? '▾ ' : '▸ ') + 'Hoạt động';
    const detailButton = get('detail-toggle');
    if (detailButton) { detailButton.textContent = prefs.open.detail ? '›' : '‹'; detailButton.setAttribute('aria-label', prefs.open.detail ? 'Thu gọn chi tiết model' : 'Mở chi tiết model'); detailButton.setAttribute('aria-expanded', String(prefs.open.detail)); }
    get('focus-mode').textContent = focusRestore ? 'Mở lại bố cục' : 'Tập trung';
    get('focus-mode').setAttribute('aria-pressed', String(!!focusRestore));
    for (const input of app.querySelectorAll('[data-layout-open]')) input.checked = prefs.open[input.dataset.layoutOpen];
    for (const [key, [, width]] of Object.entries(targets)) app.style.setProperty('--' + key + '-width', (prefs.sizes[key] || width) + 'px');
    refresh();
  }
  function refresh() {
    const detailButton = get('detail-toggle');
    if (detailButton) { detailButton.textContent = prefs.open.detail ? '›' : '‹'; detailButton.setAttribute('aria-expanded', String(prefs.open.detail)); detailButton.setAttribute('aria-label', prefs.open.detail ? 'Thu gọn chi tiết model' : 'Mở chi tiết model'); }
    for (const [key, [id, fallback, min, max]] of Object.entries(targets)) {
      const target = get(id);
      if (!target) continue;
      const existing = target.querySelector(`[data-resize-key="${key}"]`);
      if (existing) { existing.setAttribute('aria-valuenow', String(prefs.sizes[key] || fallback)); continue; }
      const handle = document.createElement('div'); handle.className = 'resize-handle resize-x'; handle.dataset.resizeKey = key;
      handle.tabIndex = 0; handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', 'Đổi kích thước ' + ({ sidebar: 'Danh sách team', inspector: 'Bảng điều khiển', feed: 'Hoạt động', detail: 'Chi tiết vị trí' })[key]);
      handle.setAttribute('aria-orientation', 'vertical'); handle.setAttribute('aria-valuemin', String(min)); handle.setAttribute('aria-valuemax', String(max)); handle.setAttribute('aria-valuenow', String(prefs.sizes[key] || fallback));
      handle.title = 'Kéo để đổi kích thước · Phím mũi tên · Nhấp đúp để đặt lại'; target.append(handle);
    }
    for (const fold of app.querySelectorAll('details[data-fold-key]')) if (fold.dataset.foldKey in prefs.folds) fold.open = prefs.folds[fold.dataset.foldKey];
  }
  function dimension(key, value, commit = false) {
    const [, , min, max] = targets[key];
    const size = Math.round(Math.max(min, Math.min(max, Math.max(min, app.clientWidth - 24), value)));
    prefs.sizes[key] = size; app.style.setProperty('--' + key + '-width', size + 'px');
    app.querySelector(`[data-resize-key="${key}"]`)?.setAttribute('aria-valuenow', String(size));
    if (commit) save();
  }
  app.addEventListener('toggle', event => {
    const node = event.target;
    if (node.matches('details[data-fold-key]') && prefs.folds[node.dataset.foldKey] !== node.open) { prefs.folds[node.dataset.foldKey] = node.open; prefs.folds = Object.fromEntries(Object.entries(prefs.folds).slice(-300)); save(); }
  }, true);
  app.addEventListener('change', event => { if (event.target.dataset.layoutOpen) setOpen(event.target.dataset.layoutOpen, event.target.checked); });
  app.addEventListener('click', event => {
    const panelButton = event.target.closest('[data-panel]');
    if (panelButton) setOpen(panelButton.dataset.panel, prefs.drawer !== panelButton.dataset.panel);
    if (event.target.closest('#close-inspector, #inspector-backdrop')) setOpen(prefs.drawer, false);
    if (event.target.closest('#sidebar-toggle')) setOpen('sidebar', !prefs.open.sidebar);
    if (event.target.closest('#sidebar-backdrop')) setOpen('sidebar', false);
    if (event.target.closest('#feed-toggle')) setOpen('feed', !prefs.open.feed);
    if (event.target.closest('#detail-toggle')) setOpen('detail', !prefs.open.detail);
    if (event.target.closest('#layout-reset')) { focusRestore = null; prefs = normalize(); apply(); save(); }
    if (event.target.closest('#focus-mode')) {
      if (focusRestore) { prefs.open = focusRestore; focusRestore = null; }
      else { focusRestore = { ...prefs.open }; prefs.drawer = null; prefs.open.sidebar = false; prefs.open.feed = false; }
      apply(); save();
    }
  });
  app.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-resize-key]');
    if (!handle || event.button !== 0) return;
    const key = handle.dataset.resizeKey;
    dragging = { key, start: event.clientX, size: get(targets[key][0]).getBoundingClientRect().width };
    event.preventDefault(); app.classList.add('resizing');
  });
  window.addEventListener('pointermove', event => { if (dragging) { const { key, start, size } = dragging; dimension(key, size + (['sidebar', 'inspector'].includes(key) ? event.clientX - start : start - event.clientX)); } });
  const finish = () => { if (dragging) { dragging = null; app.classList.remove('resizing'); save(); } };
  window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('blur', finish);
  app.addEventListener('keydown', event => {
    const key = event.target.dataset.resizeKey;
    if (!key || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { delete prefs.sizes[key]; apply(); save(); return; }
    const direction = ['sidebar', 'inspector'].includes(key) ? 1 : -1;
    dimension(key, get(targets[key][0]).getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20) * direction, true);
  });
  app.addEventListener('dblclick', event => { const key = event.target.dataset.resizeKey; if (key) { delete prefs.sizes[key]; apply(); save(); } });
  apply();
  return { refresh, restore(value) { focusRestore = null; prefs = normalize(value); apply(); }, open(key) { setOpen(key, true); }, collapseSidebar() { setOpen('sidebar', false); }, close() { if (prefs.drawer) setOpen(prefs.drawer, false); }, snapshot: () => structuredClone(prefs) };
}
