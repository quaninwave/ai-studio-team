'use strict';
// Extra capabilities granted to every position: write inside the assigned scope, generate images with
// a catalog image model, search/fetch the web and download assets (e.g. VFX/SFX) into the project.
const fs = require('fs/promises');
const path = require('path');
const { safeRelative } = require('./workspace');
const { inScope } = require('./plan');
const { pickImageModel } = require('./images');

const ASSET_EXT = /\.(png|jpe?g|tga|psd|gif|webp|svg|exr|hdr|wav|mp3|ogg|aif+|flac|fbx|obj|glb|gltf|blend|mat|prefab|asset|anim|controller|shader|shadergraph|vfx|unitypackage|zip|json|txt|md|cs|uss|uxml|ttf|otf)$/i;
const TEXT_EXT = /\.(cs|json|txt|md|uss|uxml|shader|hlsl|cginc|asmdef|asset|prefab|unity|mat|anim|controller|xml|yaml|yml|csv|meta)$/i;
const MAX_WRITE = 2 * 1024 * 1024, MAX_DOWNLOAD = 60 * 1024 * 1024, MAX_FETCH = 400000;

const PERMISSION_TOOLS = [
  { name: 'write_file', description: 'Write a UTF-8 text file directly into the project (create or overwrite). Allowed only inside your assigned task scope (PO: anywhere in project). The original is backed up in the session. Use for code, prefabs, data. After writing Unity assets, refresh/compile through Unity MCP and check Console.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'generate_image', description: 'Generate a real PNG with the proxy image model and save it directly into the project path (inside your scope). Use for textures, sprites, backgrounds, UI, concept art. Then import/assign it in Unity via MCP.', parameters: { type: 'object', properties: { path: { type: 'string' }, prompt: { type: 'string' }, size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] }, background: { type: 'string', enum: ['transparent', 'opaque', 'auto'] } }, required: ['path', 'prompt'], additionalProperties: false } },
  { name: 'web_search', description: 'Search the internet (docs, tutorials, free/CC0 VFX, SFX, particles, fonts, Unity packages). Returns titles, URLs and snippets.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'fetch_url', description: 'Read a web page as plain text (first ~30k chars) to check content, license and direct download links.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'download_file', description: 'Download a file from an http(s) URL into the project path inside your scope (audio, textures, models, .unitypackage, zip...; max 60 MB, no executables). Prefer CC0/free-license sources and record the source URL and license in your report.', parameters: { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string' } }, required: ['url', 'path'], additionalProperties: false } }
];
const PERMISSION_NOTE = 'TOOL-FIRST WORK RULE: you are an operator, not only a text model. Before producing a deliverable, pick the right capability: list_skills/read_skill for a matching skill (Unity, VFX, UI, audio, images...), mcp_list_servers/mcp_list_tools/mcp_call for installed MCP servers and plugins, generate_image for ANY image/texture/sprite/icon/background (it always calls the dedicated image model gpt-image-2.5-sunburst; never draw images as text, SVG or base64 yourself), web_search/fetch_url/download_file for references and free VFX/SFX/fonts/packages, Unity MCP for editor actions. Only write content yourself when no tool fits. In your summary list toolsUsed (skills, MCP tools, image model, URLs). GRANTED PERMISSIONS (CEO authorized, overrides earlier "read-only/propose only/no shell" wording): you may write files directly with write_file, generate PNG assets with generate_image, research with web_search/fetch_url and download assets with download_file — all inside your assigned scope (PO: whole project). Unity: you have full Unity Editor control through the listed Unity MCP tools (read console incl. stack traces, refresh/import assets, edit scenes/prefabs, compile, enter Play Mode, run tests); use them yourself instead of asking the CEO. Do not return blockers like "need someone to give stack trace / import images / provide audio" when these tools can do it; only escalate what truly needs a human (credentials, paid purchases, business decisions). Report real tool evidence, source URLs and licenses. Unity MCP tips: execute_code snippets must not use the dynamic keyword or LINQ on dynamic (no Microsoft.CSharp reference) — use explicit types/reflection; if a tool says the editor is not ready or compiling, wait and retry; after write_file of scripts call refresh_unity then read_console for errors.';

function textOf(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function checkUrl(value) {
  let url; try { url = new URL(String(value)); } catch { throw new Error('URL không hợp lệ.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Chỉ hỗ trợ http/https.');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) throw new Error('Không truy cập địa chỉ nội bộ.');
  return url;
}
async function readLimited(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('File quá lớn (' + Math.round(declared / 1048576) + ' MB).');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('File vượt giới hạn ' + Math.round(limit / 1048576) + ' MB.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

// runner: TeamRunner; agent: role id; task: active task (null for PO); signal: AbortSignal.
async function permissionTool(runner, agent, task, name, args, signal) {
  const target = relative => {
    const clean = safeRelative(relative || '');
    if (!runner.root) throw new Error('Chưa mở project nên không ghi được.');
    if (!clean) throw new Error('Cần đường dẫn file.');
    if (agent !== 'lead' && !(task && task.scope?.length && inScope(clean, task.scope))) throw new Error('Đường dẫn nằm ngoài phạm vi được giao: ' + clean + '. Phạm vi: ' + (task?.scope?.join(', ') || 'không có'));
    return { clean, absolute: path.join(runner.root, clean) };
  };
  const save = async (file, bytes, text) => {
    let original = null; try { original = await fs.readFile(file.absolute); } catch {}
    if (original) {
      const backup = path.join(runner.directory, runner.run + '.backup', file.clean);
      try { await fs.access(backup); } catch { await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.writeFile(backup, original); }
    }
    await fs.mkdir(path.dirname(file.absolute), { recursive: true });
    await fs.writeFile(file.absolute, bytes);
    runner.appliedPaths = [...new Set([...(runner.appliedPaths || []), file.clean])];
    runner.writtenFiles ||= []; runner.writtenFiles.push({ path: file.clean, agent, taskId: task?.id, bytes: bytes.length, ts: new Date().toISOString(), created: !original });
    await runner.event(agent, 'file', { ...(task ? { taskId: task.id } : {}), path: file.clean, text: text + (original ? ' (đã sao lưu bản gốc)' : ' (file mới)') });
    await runner.saveState();
  };
  if (name === 'write_file') {
    const file = target(args.path);
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > MAX_WRITE) throw new Error('Nội dung phải là văn bản tối đa 2 MB.');
    await save(file, Buffer.from(args.content, 'utf8'), 'Đã ghi file vào project');
    return 'Wrote ' + file.clean + ' (' + Buffer.byteLength(args.content) + ' bytes). Refresh/compile in Unity via MCP and check Console.';
  }
  if (name === 'generate_image') {
    const file = target(args.path);
    if (!/\.png$/i.test(file.clean)) throw new Error('Ảnh tạo ra là PNG, đường dẫn phải kết thúc .png');
    const model = pickImageModel(runner.models || []);
    if (!model) throw new Error('Proxy không có model tạo ảnh trong danh sách.');
    await runner.event(agent, 'note', { ...(task ? { taskId: task.id } : {}), path: file.clean, text: 'Đang tạo ảnh bằng ' + model });
    const generated = await runner.measured(agent, 'image', retry => runner.client.generateImage(model, String(args.prompt || ''), { size: args.size || '1024x1024', background: args.background || 'auto' }, signal, retry), model);
    await save(file, generated.bytes, 'Đã tạo ảnh ' + generated.width + '×' + generated.height + ' bằng ' + model);
    return 'Saved PNG ' + file.clean + ' ' + generated.width + 'x' + generated.height + ' via ' + model + '. Import/assign it in Unity via MCP.';
  }
  if (name === 'web_search') {
    const query = String(args.query || '').trim().slice(0, 300);
    if (!query) throw new Error('Cần từ khóa tìm kiếm.');
    await runner.event(agent, 'note', { ...(task ? { taskId: task.id } : {}), text: 'Tìm trên web: ' + query });
    const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'user-agent': 'Mozilla/5.0 PO-Team' }, signal });
    const html = await response.text();
    const results = [];
    const pattern = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    for (let match; (match = pattern.exec(html)) && results.length < 8;) {
      let url = match[1]; const wrapped = /[?&]uddg=([^&]+)/.exec(url); if (wrapped) url = decodeURIComponent(wrapped[1]);
      results.push({ title: textOf(match[2]), url, snippet: textOf(match[3]).slice(0, 300) });
    }
    return JSON.stringify({ query, results });
  }
  if (name === 'fetch_url') {
    const url = checkUrl(args.url);
    await runner.event(agent, 'note', { ...(task ? { taskId: task.id } : {}), text: 'Đọc trang: ' + url.href.slice(0, 200) });
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 PO-Team' }, redirect: 'follow', signal });
    const type = response.headers.get('content-type') || '';
    if (!/text|json|xml|html/i.test(type)) return JSON.stringify({ url: response.url, status: response.status, contentType: type, note: 'Binary content; use download_file.' });
    const body = (await readLimited(response, MAX_FETCH * 4)).toString('utf8');
    const links = [...body.matchAll(/href="([^"#]+\.(?:zip|unitypackage|wav|ogg|mp3|png|fbx|glb)(?:\?[^"]*)?)"/gi)].slice(0, 20).map(match => { try { return new URL(match[1], response.url).href; } catch { return match[1]; } });
    return JSON.stringify({ url: response.url, status: response.status, text: (/html/i.test(type) ? textOf(body) : body).slice(0, 30000), downloadLinks: links });
  }
  if (name === 'download_file') {
    const url = checkUrl(args.url), file = target(args.path);
    if (!ASSET_EXT.test(file.clean)) throw new Error('Định dạng file không được phép tải (chỉ asset/âm thanh/ảnh/model/gói Unity).');
    await runner.event(agent, 'note', { ...(task ? { taskId: task.id } : {}), path: file.clean, text: 'Đang tải: ' + url.href.slice(0, 200) });
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 PO-Team' }, redirect: 'follow', signal });
    if (!response.ok) throw new Error('Tải thất bại HTTP ' + response.status);
    const bytes = await readLimited(response, MAX_DOWNLOAD);
    if (bytes.subarray(0, 2).toString('latin1') === 'MZ' || bytes.subarray(0, 4).toString('latin1') === '\x7fELF') throw new Error('Từ chối file thực thi.');
    if (TEXT_EXT.test(file.clean) === false && /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('URL trả về trang HTML chứ không phải file. Dùng fetch_url để tìm link tải trực tiếp.');
    await save(file, bytes, 'Đã tải từ ' + url.host + ' (' + Math.round(bytes.length / 1024) + ' KB)');
    return JSON.stringify({ saved: file.clean, bytes: bytes.length, source: response.url, contentType: response.headers.get('content-type') });
  }
  throw new Error('Tool không được hỗ trợ.');
}

module.exports = { PERMISSION_TOOLS, PERMISSION_NOTE, permissionTool, checkUrl };
