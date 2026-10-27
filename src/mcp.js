'use strict';
const crypto = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

function validateServer(input) {
  if (!input || !/^[a-z][a-z0-9_-]{0,39}$/.test(input.id)) throw new Error('MCP ID không hợp lệ.');
  if (!['http', 'sse', 'stdio'].includes(input.type)) throw new Error('MCP transport: http, sse hoặc stdio.');
  // Imported servers carry host-provided headers/env; these are never persisted by the extension.
  const strings = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) : undefined;
  const extra = { ...(strings(input.headers) ? { headers: strings(input.headers) } : {}), ...(Number.isFinite(input.connectTimeout) ? { connectTimeout: input.connectTimeout } : {}) };
  if (input.type === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || !Array.isArray(input.args) || input.args.some(arg => typeof arg !== 'string')) throw new Error('MCP stdio cần command và args dạng mảng chuỗi.');
    return { id: input.id, type: input.type, command: input.command, args: input.args, ...(strings(input.env) ? { env: strings(input.env) } : {}), ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}), ...extra };
  }
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP cần URL http(s) không chứa mật khẩu.');
  return { id: input.id, type: input.type, url: url.toString(), ...extra };
}

function parseServerInput(raw) {
  const text = String(raw || '').trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { throw new Error('Địa chỉ MCP không hợp lệ. Ví dụ: http://127.0.0.1:8080/mcp'); }
    const unity = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '8080' && ['/', '/mcp', '/mcp/'].includes(url.pathname);
    if (unity && url.pathname === '/') url.pathname = '/mcp';
    return validateServer({ id: unity ? 'unity' : 'server-' + crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 10), type: 'http', url: url.toString() });
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Nhập URL MCP (http://127.0.0.1:8080/mcp) hoặc cấu hình JSON hợp lệ.'); }
  return validateServer(value);
}

// Each runner owns its connections; no shared project context or background server.
class McpTools {
  constructor(servers = [], secret = async () => undefined) {
    this.servers = servers.map(validateServer); this.secret = secret; this.clients = []; this.definitions = []; this.routes = new Map(); this.errors = [];
    if (this.servers.length > 8 || new Set(this.servers.map(server => server.id)).size !== this.servers.length) throw new Error('MCP cần tối đa 8 server với ID riêng.');
  }
  async connect(signal) {
    for (const server of this.servers) {
      signal?.throwIfAborted();
      const client = new Client({ name: 'po-team-live', version: '0.5.0' });
      try {
        const token = await this.secret(server.id);
        const headers = { ...(server.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
        const requestInit = Object.keys(headers).length ? { headers } : undefined;
        const transport = server.type === 'stdio' ? new StdioClientTransport({ command: server.command, args: server.args, stderr: 'ignore', ...(server.env ? { env: { ...process.env, ...server.env } } : {}), ...(server.cwd ? { cwd: server.cwd } : {}) })
          : server.type === 'sse' ? new SSEClientTransport(new URL(server.url), { requestInit })
          : new StreamableHTTPClientTransport(new URL(server.url), { requestInit });
        await client.connect(transport, { signal, timeout: server.connectTimeout || 15000 });
        this.clients.push(client);
        if (client.getServerCapabilities()?.resources) {
          for (const action of ['list_resources', 'read_resource']) {
            const name = 'mcp_' + crypto.createHash('sha256').update(server.id + '\0resource:' + action).digest('hex').slice(0, 40);
            this.routes.set(name, { client, server: server.id, tool: action, resource: true });
            this.definitions.push({ name, description: 'MCP ' + server.id + ' / ' + action + ': inspect resources for editor/project state before actions.', parameters: action === 'list_resources' ? { type: 'object', properties: { cursor: { type: 'string' } } } : { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } });
          }
        }
        if (!client.getServerCapabilities()?.tools) continue;
        let cursor, pages = 0;
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 });
          for (const tool of page.tools) {
            if (this.definitions.length >= 100) break;
            const name = 'mcp_' + crypto.createHash('sha256').update(server.id + '\0' + tool.name).digest('hex').slice(0, 40);
            if (this.routes.has(name)) continue;
            this.routes.set(name, { client, server: server.id, tool: tool.name });
            this.definitions.push({ name, description: ('MCP ' + server.id + ' / ' + tool.name + ': ' + (tool.description || '')).slice(0, 4000), parameters: tool.inputSchema || { type: 'object', properties: {} } });
          }
          cursor = page.nextCursor;
        } while (cursor && ++pages < 10 && this.definitions.length < 100);
      } catch (error) {
        await client.close().catch(() => {});
        this.clients = this.clients.filter(item => item !== client);
        for (const [name, route] of this.routes) if (route.client === client) this.routes.delete(name);
        this.definitions = this.definitions.filter(tool => this.routes.has(tool.name));
        const auth = /\b401\b|unauthori[sz]ed|invalid_token|oauth/i.test(String(error?.message || ''));
        this.errors.push({ server: server.id, error: auth ? 'MCP cần đăng nhập (OAuth/token). Thêm token qua PO Team: Kết nối MCP.' : 'Không kết nối/khám phá được MCP. Kiểm tra server, transport và credential.' });
        if (signal?.aborted) throw error;
      }
    }
    return this.definitions;
  }
  has(name) { return this.routes.has(name); }
  async call(name, args, signal) {
    const route = this.routes.get(name);
    if (!route) throw new Error('Tool MCP chưa được kết nối.');
    const options = { signal, timeout: 120000 };
    if (route.resource) {
      const response = route.tool === 'list_resources' ? await route.client.listResources(args, options) : await route.client.readResource(args, options);
      const safe = route.tool === 'list_resources' ? response : { contents: response.contents.map(item => ({ uri: item.uri, mimeType: item.mimeType, text: item.text, ...(item.blob ? { binary: 'not viewed' } : {}) })) };
      return JSON.stringify(safe).slice(0, 60000);
    }
    // Unity editor is busy (compiling/importing/domain reload): wait and retry instead of returning a false failure.
    let response;
    for (let attempt = 0; ; attempt++) {
      response = await route.client.callTool({ name: route.tool, arguments: args }, undefined, options);
      const text = (response.content || []).filter(item => item.type === 'text').map(item => item.text).join(' ') + JSON.stringify(response.structuredContent || {});
      if (attempt >= 4 || !/not ready|ping not answered|"hint"\s*:\s*"retry"|waiting for editor readiness|is compiling|domain reload/i.test(text)) break;
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 5000 * (attempt + 1)); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
    }
    // Do not forward binary data to text-only models or claim screenshots were viewed.
    const content = (response.content || []).map(item => item.type === 'text' ? item.text : '[MCP ' + item.type + ' received; binary not viewed by this text model]');
    return JSON.stringify({ server: route.server, tool: route.tool, isError: !!response.isError, content, structuredContent: response.structuredContent }).slice(0, 60000);
  }
  async close() { await Promise.allSettled(this.clients.map(client => client.close())); this.clients = []; }
}
module.exports = { McpTools, validateServer, parseServerInput };
