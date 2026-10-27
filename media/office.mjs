import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// Office view: PO sits in a glass room, every position has its own desk, project folders are filing cabinets.
const R = window.PoReducer;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STATE_COLOR = { working: '#4cc2ff', planning: '#a98bff', coordinating: '#a98bff', review: '#ffbf47', assigned: '#7fb2ff', rework: '#ff9b5c', error: '#ff5c6c', done: '#3ddc84', approved: '#3ddc84', ended: '#3ddc84', stopped: '#6f7888', paused: '#6f7888', idle: '#2c3442' };
const BUSY = new Set(['working', 'planning', 'coordinating', 'review']);
const SHOW_PILL = new Set(['working', 'planning', 'coordinating', 'review', 'rework', 'assigned', 'error']);
const COLS = 4, DESK_DX = 3.7, DESK_DZ = 4, FIRST_ROW = 0.6;

export function createOffice(container, openFile, openAgent = () => {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161c28);
  scene.fog = new THREE.Fog(0x161c28, 55, 110);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minDistance = 6;
  controls.maxDistance = 70;
  scene.add(new THREE.HemisphereLight(0xfff3e2, 0x2a3140, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.1);
  sun.position.set(-14, 24, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 24, bottom: -24, far: 80 });
  scene.add(sun);
  const fill = new THREE.PointLight(0x9ccaff, 60, 40);
  fill.position.set(-12, 6, 0);
  scene.add(fill);

  const desks = {};
  const cabinets = new Map();
  const packets = [];
  const pickables = [];
  let state = R.emptyState();
  let active = true;
  let rows = 1;
  let last = performance.now();
  const ids = () => R.agentIds(state);
  const meta = id => R.meta(state, id);
  const compact = (text, max = 22) => { text = String(text || ''); return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text; };

  function mesh(geometry, color, options = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 0.7, metalness: options.metalness ?? 0, emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 1, transparent: options.opacity !== undefined, opacity: options.opacity ?? 1 });
    const item = new THREE.Mesh(geometry, material);
    item.castShadow = options.shadow !== false;
    item.receiveShadow = true;
    return item;
  }
  function box(parent, size, position, color, options) {
    const item = mesh(new THREE.BoxGeometry(...size), color, options);
    item.position.set(...position);
    parent.add(item);
    return item;
  }
  function cylinder(parent, top, bottom, height, position, color, options) {
    const item = mesh(new THREE.CylinderGeometry(top, bottom, height, 20), color, options);
    item.position.set(...position);
    parent.add(item);
    return item;
  }
  function label(text, { color = '#e8eef8', background = 'rgba(17,24,36,0.88)', border = '', height = 0.42, weight = 600 } = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${weight} 40px "Segoe UI", system-ui, sans-serif`;
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 44;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = background;
    ctx.beginPath(); ctx.roundRect(2, 2, canvas.width - 4, 60, 30); ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 22, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(canvas.width / 64 * height, height, 1);
    sprite.renderOrder = 10;
    return sprite;
  }
  function dispose(object) {
    object.traverse(node => {
      node.geometry?.dispose();
      if (node.material) for (const material of [].concat(node.material)) { material.map?.dispose(); material.dispose(); }
    });
  }
  function drop(parent, object) { if (!object) return; parent.remove(object); dispose(object); }

  // ---------- Building shell ----------
  const plank = document.createElement('canvas');
  plank.width = 256; plank.height = 256;
  {
    const ctx = plank.getContext('2d');
    for (let row = 0; row < 8; row++) {
      const tone = 118 + (row * 37 % 5) * 6;
      ctx.fillStyle = `rgb(${tone},${Math.round(tone * 0.78)},${Math.round(tone * 0.58)})`;
      ctx.fillRect(0, row * 32, 256, 32);
      ctx.fillStyle = 'rgba(40,24,12,0.35)';
      ctx.fillRect(0, row * 32, 256, 2);
      ctx.fillRect((row * 97) % 256, row * 32, 2, 32);
    }
  }
  const floorTexture = new THREE.CanvasTexture(plank);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(8, 8);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(32, 0.3, 30), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8 }));
  floor.position.set(0, -0.15, 1);
  floor.receiveShadow = true;
  scene.add(floor);
  const wallColor = 0xc9cfd8;
  box(scene, [32, 3.2, 0.3], [0, 1.6, -14], wallColor);
  box(scene, [0.3, 3.2, 30], [-16, 1.6, 1], wallColor);
  box(scene, [32, 0.12, 0.34], [0, 0.06, -13.85], 0x59606c);
  for (let index = 0; index < 4; index++) {
    box(scene, [0.06, 1.6, 4.2], [-15.82, 1.8, -8 + index * 6.5], 0xa9d4ff, { emissive: 0x8fc4ff, emissiveIntensity: 0.55, opacity: 0.85, shadow: false });
    box(scene, [0.1, 1.72, 0.08], [-15.8, 1.8, -8 + index * 6.5], 0x7a828f);
  }
  // Wall dashboard with live progress.
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024; boardCanvas.height = 384;
  const boardTexture = new THREE.CanvasTexture(boardCanvas);
  boardTexture.colorSpace = THREE.SRGBColorSpace;
  box(scene, [9.4, 3.5, 0.12], [8, 1.95, -13.78], 0x1f2530);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.1), new THREE.MeshBasicMaterial({ map: boardTexture, toneMapped: false }));
  board.position.set(8, 1.95, -13.7);
  scene.add(board);
  let boardSignature = '';
  function drawBoard() {
    const tasks = state.tasks || [];
    const done = tasks.filter(task => ['approved', 'done'].includes(task.status)).length;
    const busy = ids().filter(id => BUSY.has(state.agents[id].status)).length;
    const errors = ids().filter(id => state.agents[id].status === 'error').length;
    const rework = tasks.filter(task => task.status === 'rework').length;
    const signature = [done, tasks.length, busy, errors, rework, state.title, state.ended].join('|');
    if (signature === boardSignature) return;
    boardSignature = signature;
    const ctx = boardCanvas.getContext('2d');
    ctx.fillStyle = '#121a26'; ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = '#8fa3bd'; ctx.font = '600 34px "Segoe UI", sans-serif';
    ctx.fillText(compact(state.title || 'Bảng tiến độ team', 46), 40, 62);
    ctx.fillStyle = '#eef3fa'; ctx.font = '700 92px "Segoe UI", sans-serif';
    const big = `${done}/${tasks.length || 0}`;
    ctx.fillText(big, 40, 178);
    const bigWidth = ctx.measureText(big).width;
    ctx.fillStyle = '#8fa3bd'; ctx.font = '500 34px "Segoe UI", sans-serif';
    ctx.fillText(state.ended ? 'task · đã kết thúc' : 'task hoàn tất', 60 + bigWidth, 172);
    ctx.fillStyle = '#263243'; ctx.beginPath(); ctx.roundRect(40, 212, 944, 26, 13); ctx.fill();
    ctx.fillStyle = '#3ddc84'; ctx.beginPath(); ctx.roundRect(40, 212, Math.max(26, 944 * (tasks.length ? done / tasks.length : 0)), 26, 13); ctx.fill();
    const chips = [[busy + ' đang làm', '#4cc2ff'], [rework + ' sửa lại', '#ff9b5c'], [errors + ' cần xử lý', errors ? '#ff5c6c' : '#55606f']];
    let x = 40;
    ctx.font = '600 34px "Segoe UI", sans-serif';
    for (const [text, color] of chips) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 12, 312, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dbe4f0'; ctx.fillText(text, x + 36, 324);
      x += ctx.measureText(text).width + 90;
    }
    boardTexture.needsUpdate = true;
  }
  function plant(x, z, scale = 1) {
    const group = new THREE.Group();
    cylinder(group, 0.38, 0.3, 0.7, [0, 0.35, 0], 0xd9d2c5);
    for (const [dx, dy, dz, r] of [[0, 1.2, 0, 0.6], [0.3, 1.55, 0.1, 0.42], [-0.25, 1.5, -0.15, 0.45]]) {
      const leaf = mesh(new THREE.IcosahedronGeometry(r, 1), 0x3f9a5c, { roughness: 0.9 });
      leaf.position.set(dx, dy, dz);
      group.add(leaf);
    }
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);
    scene.add(group);
  }
  plant(-14.8, -12.8, 1.2); plant(14.8, -12.8, 1.1); plant(-14.8, 14.8); plant(2.8, -12.9, 0.9);
  // Lounge corner near the windows.
  const sofa = new THREE.Group();
  box(sofa, [3.2, 0.5, 1.1], [0, 0.35, 0], 0x4a5d7a);
  box(sofa, [3.2, 0.8, 0.3], [0, 0.8, -0.45], 0x4a5d7a);
  box(sofa, [1.2, 0.4, 0.8], [0, 0.2, 1.4], 0x8a6a4f);
  sofa.position.set(-13.4, 0, 8);
  sofa.rotation.y = Math.PI / 2;
  scene.add(sofa);

  // ---------- PO glass office ----------
  const poRoom = new THREE.Group();
  poRoom.position.set(-3.5, 0, -10.6);
  scene.add(poRoom);
  box(poRoom, [9, 0.04, 6.2], [0, 0.02, 0], 0x3c3358, { roughness: 0.95 });
  const glassOptions = { opacity: 0.18, roughness: 0.1, metalness: 0.1, shadow: false };
  box(poRoom, [6.4, 2.6, 0.06], [-1.3, 1.3, 3.1], 0xbfe0ff, glassOptions);
  box(poRoom, [0.06, 2.6, 6.2], [4.5, 1.3, 0], 0xbfe0ff, glassOptions);
  box(poRoom, [0.08, 0.08, 6.2], [4.5, 2.62, 0], 0x7a828f);
  box(poRoom, [9, 0.08, 0.08], [0, 2.62, 3.1], 0x7a828f);
  const poSign = label('Phòng PO · Điều phối', { color: '#d8c5ff', background: 'rgba(42,30,70,0.92)', height: 0.56 });
  poSign.position.set(-1.3, 3.15, 3.1);
  poRoom.add(poSign);
  box(poRoom, [4, 1.8, 0.08], [0, 1.9, -2.95], 0xf3f5f8, { roughness: 0.3 });
  for (let index = 0; index < 4; index++) box(poRoom, [0.8, 0.5, 0.02], [-1.4 + index * 0.95, 1.95 + (index % 2) * 0.25, -2.9], [0xffd166, 0x9ad0ff, 0xb9f0c9, 0xffb3c1][index], { shadow: false });

  // ---------- Desks and people ----------
  function person(color) {
    const group = new THREE.Group();
    const shirt = new THREE.Color(color).getHex();
    cylinder(group, 0.27, 0.34, 0.7, [0, 0.98, 0], shirt, { roughness: 0.8 });
    const head = mesh(new THREE.SphereGeometry(0.25, 20, 16), 0xf0c8a4, { roughness: 0.6 });
    head.position.set(0, 1.58, 0);
    group.add(head);
    const hair = mesh(new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), 0x3a2b23, { roughness: 0.9 });
    hair.position.set(0, 1.6, 0.02);
    group.add(hair);
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.33, 1.2, 0);
      box(arm, [0.13, 0.13, 0.55], [0, -0.12, -0.25], shirt);
      box(arm, [0.11, 0.11, 0.11], [0, -0.14, -0.55], 0xf0c8a4);
      group.add(arm);
      arms.push(arm);
      box(group, [0.16, 0.16, 0.6], [side * 0.14, 0.55, -0.25], 0x2f3a4c);
    }
    return { group, head, arms };
  }
  function deskFor(id, isLead) {
    const color = meta(id).color;
    const width = isLead ? 2.6 : 2;
    const group = new THREE.Group();
    box(group, [width, 0.08, 1], [0, 0.78, 0], isLead ? 0x6b4a33 : 0xe9e4dc, { roughness: 0.5 });
    for (const x of [-1, 1]) box(group, [0.06, 0.74, 0.9], [x * (width / 2 - 0.1), 0.37, 0], 0x59606c);
    const strip = box(group, [width, 0.05, 0.03], [0, 0.73, 0.52], 0x222a36, { shadow: false });
    box(group, [0.08, 0.32, 0.08], [0, 0.98, -0.3], 0x2b313b);
    box(group, [1.05, 0.62, 0.06], [0, 1.42, -0.32], 0x1b2029);
    const screen = mesh(new THREE.PlaneGeometry(0.96, 0.54), 0x0e131b, { shadow: false });
    screen.position.set(0, 1.42, -0.285);
    group.add(screen);
    box(group, [0.6, 0.03, 0.2], [0, 0.835, 0.05], 0x3a414d);
    box(group, [0.12, 0.2, 0.12], [width / 2 - 0.3, 0.92, -0.1], 0xffffff, { roughness: 0.4 });
    const chair = new THREE.Group();
    box(chair, [0.62, 0.1, 0.6], [0, 0.5, 0], 0x2f3744);
    box(chair, [0.62, 0.72, 0.1], [0, 0.92, 0.3], new THREE.Color(color).multiplyScalar(0.6).getHex());
    cylinder(chair, 0.04, 0.04, 0.45, [0, 0.25, 0], 0x59606c);
    cylinder(chair, 0.3, 0.3, 0.04, [0, 0.03, 0], 0x3a414d);
    chair.position.set(0, 0, 0.95);
    group.add(chair);
    const body = person(color);
    body.group.position.set(0, 0, 0.92);
    group.add(body.group);
    const name = label(compact(meta(id).short || meta(id).name, 22), { color, background: 'rgba(14,20,30,0.88)', height: 0.5 });
    name.position.set(0, 2.45, 0.7);
    group.add(name);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 2.1, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.set(0, 1.05, 0.5);
    pick.userData.agent = id; name.userData.agent = id;
    group.add(pick);
    scene.add(group);
    return { id, group, body, screen, strip, name, pick, pill: null, pillText: '', signature: meta(id).name + color + isLead, target: new THREE.Vector3(), placed: false };
  }
  function deskPosition(index, count) {
    const row = Math.floor(index / COLS);
    const inRow = Math.min(COLS, count - row * COLS);
    return new THREE.Vector3((index % COLS - (inRow - 1) / 2) * DESK_DX - 1.5, 0, FIRST_ROW + row * DESK_DZ);
  }

  // ---------- Filing cabinets for project folders ----------
  function cabinetFor(key) {
    if (cabinets.has(key)) return cabinets.get(key);
    const group = new THREE.Group();
    box(group, [0.9, 1.5, 1.5], [0, 0.75, 0], 0x8a93a3, { roughness: 0.5, metalness: 0.2 });
    for (const y of [0.4, 0.85, 1.3]) box(group, [0.04, 0.36, 1.3], [-0.47, y, 0], 0x9da6b6, { roughness: 0.4 });
    const glow = box(group, [0.05, 1.4, 0.06], [-0.48, 0.75, 0.72], 0x222a36, { shadow: false });
    const caption = label('🗂 ' + compact(key === '/' ? 'Thư mục gốc' : key, 26), { color: '#c9d7ea', height: 0.42 });
    caption.position.set(0, 1.95, 0);
    group.add(caption);
    scene.add(group);
    const cabinet = { key, group, glow, files: [], signature: '', link: null };
    cabinets.set(key, cabinet);
    [...cabinets.values()].forEach((item, index) => item.group.position.set(11.6 - Math.floor(index / 6) * 2.6, 0, -9 + (index % 6) * 3));
    return cabinet;
  }
  function clearCabinets() {
    pickables.length = 0;
    for (const cabinet of cabinets.values()) { drop(scene, cabinet.group); drop(scene, cabinet.link); }
    cabinets.clear();
  }

  // ---------- Flying documents ----------
  function packet(from, to, color) {
    if (reduced) return;
    const start = from.clone().add(new THREE.Vector3(0, 1.6, 0.5));
    const end = to.clone().add(new THREE.Vector3(0, 1.6, 0.5));
    const curve = new THREE.QuadraticBezierCurve3(start, start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 3.5, 0)), end);
    const paper = box(scene, [0.5, 0.04, 0.36], [0, 0, 0], 0xffffff, { emissive: new THREE.Color(color).getHex(), emissiveIntensity: 0.6, shadow: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
    scene.add(line);
    packets.push({ paper, line, curve, progress: 0 });
  }

  // ---------- Overlays ----------
  const tip = document.createElement('div');
  tip.className = 'office-tip';
  tip.hidden = true;
  container.append(tip);
  const legend = document.createElement('div');
  legend.className = 'office-legend';
  legend.innerHTML = [['#4cc2ff', 'Đang làm'], ['#ffbf47', 'Review / chờ'], ['#ff9b5c', 'Sửa lại'], ['#3ddc84', 'Xong'], ['#ff5c6c', 'Cần xử lý']].map(([color, text]) => `<span><i style="background:${color}"></i>${text}</span>`).join('');
  container.append(legend);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function setStatus(desk) {
    const info = state.agents[desk.id];
    const stalled = info.stalled && BUSY.has(info.status);
    const color = stalled ? '#ffbf47' : STATE_COLOR[info.status] || STATE_COLOR.idle;
    const lit = info.status !== 'idle';
    desk.screen.material.emissive.set(lit ? color : '#000000');
    desk.screen.material.emissiveIntensity = lit ? 0.9 : 0;
    desk.strip.material.emissive.set(lit ? color : '#000000');
    desk.strip.material.emissiveIntensity = lit ? 1.4 : 0;
    const text = stalled ? '⏳ Chờ model' : info.status === 'error' ? '⚠ Cần xử lý' : SHOW_PILL.has(info.status) ? R.STATUS[info.status] : '';
    if (text !== desk.pillText) {
      drop(desk.group, desk.pill);
      desk.pillText = text;
      desk.pill = text ? label(text, { color: '#0d131c', background: color, height: 0.42, weight: 700 }) : null;
      if (desk.pill) { desk.pill.position.set(0, 3.05, 0.7); desk.group.add(desk.pill); }
    }
  }

  function update(next, event, reset = false) {
    state = next;
    const lead = state.coordinator;
    const workers = ids().filter(id => id !== lead);
    const previousRows = rows;
    rows = Math.max(1, Math.ceil(workers.length / COLS));
    for (const id of Object.keys(desks)) {
      if (!state.agents[id] || desks[id].signature !== meta(id).name + meta(id).color + (id === lead)) { drop(scene, desks[id].group); delete desks[id]; }
    }
    for (const id of ids()) if (!desks[id]) desks[id] = deskFor(id, id === lead);
    if (desks[lead]) { desks[lead].target.set(-3.5, 0, -11.6); desks[lead].group.position.copy(desks[lead].target); desks[lead].placed = true; }
    workers.forEach((id, index) => {
      const desk = desks[id];
      desk.target.copy(deskPosition(index, workers.length));
      if (reset || reduced || !desk.placed) { desk.group.position.copy(desk.target); desk.placed = true; }
    });
    for (const id of ids()) setStatus(desks[id]);
    if (reset) {
      clearCabinets();
      for (const card of packets.splice(0)) { drop(scene, card.paper); drop(scene, card.line); }
    }
    for (const [key, folder] of Object.entries(state.folders)) {
      const cabinet = cabinetFor(key);
      const signature = JSON.stringify(folder.files) + folder.agent;
      if (signature !== cabinet.signature) {
        for (const tile of cabinet.files) { drop(cabinet.group, tile); const index = pickables.indexOf(tile); if (index >= 0) pickables.splice(index, 1); }
        const shown = folder.files.slice(-3);
        cabinet.files = shown.map((file, index) => {
          const tile = label('📄 ' + compact(file, 20), { color: '#eaf1fb', background: 'rgba(36,48,66,0.92)', border: meta(folder.agent).color, height: 0.36, weight: 500 });
          tile.position.set(-0.7, 0.4 + index * 0.48, 0);
          tile.center.set(1, 0.5);
          tile.userData.path = Object.keys(state.files).find(path => R.folderKey(path) === key && R.baseName(path) === file);
          cabinet.group.add(tile);
          pickables.push(tile);
          return tile;
        });
        if (folder.files.length > 3) {
          const more = label('+' + (folder.files.length - 3) + ' file', { color: '#9fb0c6', height: 0.24 });
          more.position.set(-0.7, 0.4 + 3 * 0.48, 0); more.center.set(1, 0.5);
          cabinet.group.add(more); cabinet.files.push(more);
        }
        cabinet.signature = signature;
      }
      const worker = workers.find(id => state.agents[id].status === 'working' && R.folderKey(state.agents[id].path) === key);
      const color = worker ? meta(worker).color : null;
      cabinet.glow.material.emissive.set(color || '#000000');
      cabinet.glow.material.emissiveIntensity = color ? 1.6 : 0;
      const linkKey = worker ? worker + color : '';
      if (cabinet.linkKey !== linkKey) {
        drop(scene, cabinet.link); cabinet.link = null; cabinet.linkKey = linkKey;
        if (worker && desks[worker]) {
          const from = desks[worker].target.clone().add(new THREE.Vector3(0, 0.04, 1.6));
          const to = cabinet.group.position.clone().add(new THREE.Vector3(-0.6, 0.04, 0));
          const geometry = new THREE.BufferGeometry().setFromPoints([from, new THREE.Vector3(from.x, 0.04, to.z > from.z ? to.z : from.z), new THREE.Vector3(to.x - 1.2, 0.04, to.z), to]);
          cabinet.link = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85 }));
          cabinet.link.computeLineDistances();
          scene.add(cabinet.link);
        }
      }
    }
    drawBoard();
    if (event?.type === 'assign' || event?.type === 'rework') {
      if (desks[event.to] && desks[event.agent]) packet(desks[event.agent].group.position, desks[event.to].target, event.type === 'rework' ? '#ff9b5c' : meta(event.to).color);
    } else if (event?.type === 'done' && desks[event.agent] && desks[lead]) packet(desks[event.agent].group.position, desks[lead].group.position, '#3ddc84');
    if (reset || rows !== previousRows) resetCamera();
  }

  // ---------- Interaction ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function hitAt(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const targets = [...pickables, ...Object.values(desks).flatMap(desk => [desk.pick, desk.name])];
    return raycaster.intersectObjects(targets, false).find(hit => hit.object.userData.path || hit.object.userData.agent);
  }
  let down = null, hoverFrame = 0, lastMove = null;
  renderer.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; tip.hidden = true; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const hit = hitAt(event);
    if (hit?.object.userData.path) openFile(hit.object.userData.path);
    else if (hit?.object.userData.agent) openAgent(hit.object.userData.agent);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    lastMove = event;
    if (hoverFrame || event.buttons) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const move = lastMove, hit = hitAt(move);
      renderer.domElement.style.cursor = hit ? 'pointer' : '';
      if (!hit) { tip.hidden = true; return; }
      const bounds = container.getBoundingClientRect();
      if (hit.object.userData.path) tip.innerHTML = `<b>${escapeHtml(hit.object.userData.path)}</b><span class="tip-hint">Bấm để mở file</span>`;
      else {
        const id = hit.object.userData.agent, info = state.agents[id] || {};
        tip.innerHTML = `<b style="color:${meta(id).color}">${escapeHtml(meta(id).name)}</b>${info.model ? `<span>${escapeHtml(info.model)}</span>` : ''}<span>${escapeHtml(R.STATUS[info.status] || info.status || '')}${info.task ? ' · ' + escapeHtml(compact(info.task, 60)) : ''}</span><span class="tip-hint">Bấm để xem chi tiết</span>`;
      }
      tip.style.left = Math.max(8, Math.min(move.clientX - bounds.left + 14, bounds.width - 270)) + 'px';
      tip.style.top = Math.min(move.clientY - bounds.top + 14, bounds.height - 110) + 'px';
      tip.hidden = false;
    });
  });
  renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });

  function resetCamera() {
    const depth = FIRST_ROW + (rows - 1) * DESK_DZ;
    controls.target.set(0, 0.4, (depth - 9) / 2);
    camera.position.set(9, 11.5 + rows * 1.4, 10.5 + depth);
    controls.update();
  }
  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const feed = container.querySelector('.feed');
    const panel = width > 760 && feed && !feed.classList.contains('folded') ? feed.clientWidth : 0;
    camera.setViewOffset(width + panel, height, panel, 0, width, height);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const feedPanel = container.querySelector('.feed');
  if (feedPanel) observer.observe(feedPanel);
  resize();
  resetCamera();
  drawBoard();

  renderer.setAnimationLoop(time => {
    const delta = Math.min((time - last) / 1000, 0.05);
    last = time;
    if (!active || document.hidden) return;
    for (const desk of Object.values(desks)) {
      const info = state.agents[desk.id];
      if (!info) continue;
      desk.group.position.lerp(desk.target, reduced ? 1 : Math.min(1, delta * 4));
      const busy = BUSY.has(info.status) && !reduced;
      desk.body.arms.forEach((arm, side) => { arm.rotation.x = busy ? Math.sin(time / 90 + side * 2) * 0.12 : 0; });
      desk.body.head.rotation.y = busy ? Math.sin(time / 900) * 0.15 : 0;
      if (info.status === 'error' && !reduced) desk.strip.material.emissiveIntensity = 0.8 + Math.abs(Math.sin(time / 260)) * 1.6;
      else if (busy) desk.screen.material.emissiveIntensity = 0.75 + Math.sin(time / 300) * 0.15;
      if (desk.pill) desk.pill.position.y = 3.05 + (busy ? Math.sin(time / 400) * 0.04 : 0);
    }
    for (let index = packets.length - 1; index >= 0; index--) {
      const card = packets[index];
      card.progress += delta / 1.5;
      card.paper.position.copy(card.curve.getPoint(Math.min(card.progress, 1)));
      card.paper.rotation.y += delta * 4;
      card.line.material.opacity = 0.5 * (1 - Math.min(card.progress, 1));
      if (card.progress >= 1) { drop(scene, card.paper); drop(scene, card.line); packets.splice(index, 1); }
    }
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    update,
    setActive(value) { active = value; if (value) resize(); },
    resetCamera,
    dispose() { observer.disconnect(); controls.dispose(); renderer.setAnimationLoop(null); dispose(scene); renderer.dispose(); renderer.domElement.remove(); tip.remove(); legend.remove(); }
  };
}
