'use strict';
// Discovers skills, plugin skills and MCP servers already installed for Codex, Claude Code and VS Code,
// so PO Team models can list, read and call them. Credentials stay in their original files and are only
// passed to the spawned/connected MCP process; they are never logged, persisted or shown to models.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse: parseToml } = require('smol-toml');

const MAX_SKILLS = 600, MAX_SKILL_BYTES = 60000;
const exists = file => { try { fs.accessSync(file); return true; } catch { return false; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields = {};
  if (match) for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair && !fields[pair[1]]) fields[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

// Finds SKILL.md files up to `depth` levels below `root`.
function scanSkills(root, source, depth = 4, prefix = '') {
  const found = [];
  const walk = (dir, level) => {
    if (level > depth || found.length > MAX_SKILLS) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
      const file = path.join(dir, 'SKILL.md');
      try {
        const meta = frontmatter(fs.readFileSync(file, 'utf8').slice(0, 4000));
        const name = (prefix ? prefix + ':' : '') + (meta.name || path.basename(dir));
        found.push({ name, description: (meta.description || '').slice(0, 300), file, source });
      } catch {}
    }
    for (const entry of entries) if (entry.isDirectory() && !['node_modules', '.git', 'assets', 'references', 'scripts', 'agents'].includes(entry.name)) walk(path.join(dir, entry.name), level + 1);
  };
  walk(root, 0);
  return found;
}

const slug = value => String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 30) || 'mcp';
function serverId(source, name, taken) {
  let id = (source + '-' + slug(name)).slice(0, 40).replace(/-+$/, '');
  if (!/^[a-z]/.test(id)) id = 'm' + id;
  if (taken.has(id)) id = id.slice(0, 33) + '-' + crypto.createHash('sha256').update(source + name).digest('hex').slice(0, 6);
  taken.add(id); return id;
}

// Normalizes the different config shapes into { type, url | command/args/env/cwd, headers }.
function normalize(raw, source, name) {
  if (!raw || typeof raw !== 'object' || raw.enabled === false || raw.disabled === true) return null;
  const headers = { ...(raw.headers || {}), ...(raw.http_headers || {}) };
  for (const [header, variable] of Object.entries(raw.env_http_headers || {})) if (process.env[variable]) headers[header] = process.env[variable];
  if (raw.bearer_token_env_var && process.env[raw.bearer_token_env_var]) headers.Authorization = 'Bearer ' + process.env[raw.bearer_token_env_var];
  if (raw.url || raw.serverUrl) {
    let url; try { url = new URL(raw.url || raw.serverUrl); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { type: raw.type === 'sse' ? 'sse' : 'http', url: url.toString(), headers, source, name };
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) return null;
  const env = { ...(raw.env || {}) };
  for (const variable of raw.env_vars || []) if (typeof variable === 'string' && process.env[variable]) env[variable] = process.env[variable];
  return { type: 'stdio', command: raw.command, args: Array.isArray(raw.args) ? raw.args.map(String) : [], env, cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined, source, name };
}

// MCP servers that only work inside their host app (desktop automation, app-internal tools).
const HOST_ONLY = /^(?:node_repl|codex_app|codex-app-tools|cua_repl|code-review|computer-use)$/i;

function discover(options = {}) {
  const home = options.home || os.homedir();
  const appData = options.appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const projectRoots = (options.projectRoots || []).map(root => path.resolve(root).replace(/\\/g, '/').toLowerCase());
  const skills = [], servers = [], skipped = [];
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex');

  for (const [dir, source, depth] of [[path.join(codexHome, 'skills'), 'codex', 2], [path.join(home, '.agents', 'skills'), 'agents', 3], [path.join(home, '.claude', 'skills'), 'claude', 2]]) {
    if (exists(dir)) skills.push(...scanSkills(dir, source, depth));
  }
  // Codex plugins: <cache>/<marketplace>/<plugin>/<version>/{skills,.mcp.json}
  const pluginCache = path.join(codexHome, 'plugins', 'cache');
  const plugins = [];
  for (const market of exists(pluginCache) ? fs.readdirSync(pluginCache) : []) {
    for (const plugin of (() => { try { return fs.readdirSync(path.join(pluginCache, market)); } catch { return []; } })()) {
      const versions = (() => { try { return fs.readdirSync(path.join(pluginCache, market, plugin)).sort(); } catch { return []; } })();
      if (versions.length) plugins.push({ dir: path.join(pluginCache, market, plugin, versions.at(-1)), name: plugin, source: 'codex-plugin' });
    }
  }
  // Claude plugins from installed_plugins.json
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  for (const [key, entries] of Object.entries(installed?.plugins || {})) {
    for (const entry of Array.isArray(entries) ? entries : [entries]) if (entry?.installPath) plugins.push({ dir: entry.installPath, name: key.split('@')[0], source: 'claude-plugin' });
  }
  const taken = new Set(), seen = new Set();
  const add = (raw, source, name) => {
    if (HOST_ONLY.test(name)) { skipped.push({ source, name, reason: 'Chỉ chạy bên trong app gốc' }); return; }
    const server = normalize(raw, source, name);
    if (!server) { skipped.push({ source, name, reason: 'Đang tắt hoặc cấu hình không hợp lệ' }); return; }
    // The same endpoint/command configured in several hosts is connected once.
    const key = server.url ? server.url.replace(/\/+$/, '').toLowerCase() : JSON.stringify([server.command.toLowerCase(), server.args]);
    if (seen.has(key)) return; seen.add(key);
    servers.push({ id: serverId(source, name, taken), ...server });
  };
  for (const plugin of plugins) {
    if (exists(path.join(plugin.dir, 'skills'))) skills.push(...scanSkills(path.join(plugin.dir, 'skills'), plugin.source, 2, plugin.name));
    const manifest = readJson(path.join(plugin.dir, '.mcp.json'));
    for (const [name, raw] of Object.entries(manifest?.mcpServers || manifest || {})) if (raw && typeof raw === 'object') add({ ...raw, cwd: raw.cwd && !path.isAbsolute(raw.cwd) ? path.join(plugin.dir, raw.cwd) : raw.cwd }, plugin.source, name);
  }
  // Codex config.toml
  try {
    const config = parseToml(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'));
    for (const [name, raw] of Object.entries(config.mcp_servers || {})) add(raw, 'codex', name);
  } catch {}
  // Claude Code user + matching project servers, Claude Desktop, VS Code
  const claude = readJson(path.join(home, '.claude.json'));
  for (const [name, raw] of Object.entries(claude?.mcpServers || {})) add(raw, 'claude', name);
  for (const [project, value] of Object.entries(claude?.projects || {})) {
    if (projectRoots.includes(path.resolve(project).replace(/\\/g, '/').toLowerCase())) for (const [name, raw] of Object.entries(value?.mcpServers || {})) add(raw, 'claude', name);
  }
  for (const [name, raw] of Object.entries(readJson(path.join(appData, 'Claude', 'claude_desktop_config.json'))?.mcpServers || {})) add(raw, 'claude-desktop', name);
  for (const [name, raw] of Object.entries(readJson(path.join(appData, 'Code', 'User', 'mcp.json'))?.servers || {})) add(raw, 'vscode', name);

  const unique = new Map();
  for (const skill of skills) if (!unique.has(skill.name.toLowerCase())) unique.set(skill.name.toLowerCase(), skill);
  return { skills: [...unique.values()].slice(0, MAX_SKILLS).sort((a, b) => a.name.localeCompare(b.name)), servers, skipped };
}

// Read-only skill tools offered to every model.
const SKILL_TOOLS = [
  { name: 'list_skills', description: 'Search installed Codex/Claude skills and plugin skills by keyword. Returns name, source and description. Use before specialised work (Unity, images, docs, video, design...).', parameters: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false } },
  { name: 'read_skill', description: 'Read a skill SKILL.md, or a file inside the skill folder (path relative to the skill). Follow its instructions using the tools you actually have.', parameters: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } }, required: ['name'], additionalProperties: false } }
];

function skillTool(skills, name, args) {
  if (name === 'list_skills') {
    const words = String(args.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = skills.filter(skill => words.every(word => (skill.name + ' ' + skill.description).toLowerCase().includes(word)));
    return JSON.stringify({ total: hits.length, skills: hits.slice(0, 60).map(skill => ({ name: skill.name, source: skill.source, description: skill.description })) });
  }
  const skill = skills.find(item => item.name.toLowerCase() === String(args.name || '').toLowerCase()) || skills.find(item => item.name.toLowerCase().endsWith(':' + String(args.name || '').toLowerCase()));
  if (!skill) throw new Error('Không có skill ' + args.name + '. Dùng list_skills để tìm.');
  const base = path.dirname(skill.file);
  const target = args.path ? path.resolve(base, String(args.path)) : skill.file;
  if (target !== skill.file && !target.startsWith(base + path.sep)) throw new Error('Chỉ đọc file trong thư mục skill.');
  if (/\.(?:env|pem|key|pfx|p12)$|(?:^|[\\/])(?:\.env|auth|credentials|secrets)(?:\.|$)/i.test(target)) throw new Error('Không đọc file bí mật.');
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return JSON.stringify({ files: fs.readdirSync(target).slice(0, 200) });
  const data = fs.readFileSync(target);
  if (data.includes(0)) throw new Error('File nhị phân.');
  return data.toString('utf8').slice(0, MAX_SKILL_BYTES);
}

module.exports = { discover, SKILL_TOOLS, skillTool, frontmatter, normalize };
