'use strict';
const fs = require('fs');
const path = require('path');

const STEPS = [
  ['opus', 'start', { title: 'Demo: thêm trang đăng nhập' }],
  ['opus', 'plan', { text: 'UI cho Sonnet, API cho Sol, tài liệu sau cùng' }],
  ['opus', 'assign', { to: 'sonnet', task: 'Form đăng nhập', path: 'src/ui/Login.tsx' }],
  ['opus', 'assign', { to: 'sol', task: 'API xác thực', path: 'src/api/auth.ts' }],
  ['sonnet', 'working', { task: 'Form đăng nhập', path: 'src/ui/Login.tsx' }],
  ['sol', 'working', { task: 'API xác thực', path: 'src/api/auth.ts' }],
  ['sonnet', 'file', { path: 'src/ui/Login.tsx' }],
  ['sol', 'file', { path: 'src/api/auth.ts' }],
  ['sonnet', 'file', { path: 'src/ui/Button.tsx' }],
  ['sol', 'file', { path: 'src/api/session.ts' }],
  ['sonnet', 'done', { task: 'Form đăng nhập', text: '2 file' }],
  ['opus', 'review', { to: 'sonnet', task: 'Form đăng nhập' }],
  ['opus', 'approved', { to: 'sonnet' }],
  ['opus', 'assign', { to: 'sonnet', task: 'Tài liệu API', path: 'docs/auth.md' }],
  ['sonnet', 'working', { task: 'Tài liệu API', path: 'docs/auth.md' }],
  ['sol', 'done', { task: 'API xác thực', text: '2 file' }],
  ['opus', 'review', { to: 'sol', task: 'API xác thực' }],
  ['opus', 'rework', { to: 'sol', text: 'Thiếu kiểm tra token hết hạn' }],
  ['sonnet', 'file', { path: 'docs/auth.md' }],
  ['sol', 'file', { path: 'src/api/session.ts' }],
  ['sol', 'error', { text: 'Test 2/9 fail' }],
  ['sol', 'file', { path: 'src/api/session.test.ts' }],
  ['sonnet', 'done', { task: 'Tài liệu API', text: '1 file' }],
  ['sol', 'done', { task: 'API xác thực', text: 'test pass' }],
  ['opus', 'review', { to: 'sol', task: 'API xác thực' }],
  ['opus', 'approved', { to: 'sol' }],
  ['opus', 'review', { to: 'sonnet', task: 'Tài liệu API' }],
  ['opus', 'approved', { to: 'sonnet' }],
  ['opus', 'end', { text: 'Hoàn thành' }]
];

const sleep = delay => new Promise(done => setTimeout(done, delay));

function startDemo(dir, delay = 1500) {
  const run = 'demo-' + Date.now().toString(36);
  const finished = (async () => {
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, run + '.jsonl');
    for (const [agent, type, fields] of STEPS) {
      const event = { ts: new Date().toISOString(), run, agent, type, ...fields };
      await fs.promises.appendFile(file, JSON.stringify(event) + '\n', 'utf8');
      await sleep(delay);
    }
  })();
  return { run, finished };
}

module.exports = { startDemo, STEPS };
