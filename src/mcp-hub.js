'use strict';
// Lazy gateway to imported MCP servers: models see 3 small tools instead of hundreds of
// definitions, and a server process starts only when a model actually needs it.
const { McpTools } = require('./mcp');

const HUB_TOOLS = [
  { name: 'mcp_list_servers', description: 'List MCP servers imported from Codex, Claude Code and VS Code (Unity, docs, video, design, browser...). Servers start only when used.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mcp_list_tools', description: 'Connect to one imported MCP server and list its tool names with short descriptions. Pass tool to get that the tool full description and input schema before calling it.', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' } }, required: ['server'], additionalProperties: false } },
  { name: 'mcp_call', description: 'Call a tool on an imported MCP server. Inspect state before actions; never repeat an uncertain call blindly.', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['server', 'tool'], additionalProperties: false } }
];

class McpHub {
  constructor(servers = [], secret = async () => undefined) {
    this.servers = servers; this.secret = secret; this.connections = new Map(); this.errors = {};
  }
  get definitions() { return this.servers.length ? HUB_TOOLS : []; }
  has(name) { return this.servers.length > 0 && HUB_TOOLS.some(tool => tool.name === name); }
  summary() { return this.servers.map(server => ({ id: server.id, from: server.source, name: server.name, type: server.type, ...(this.errors[server.id] ? { error: this.errors[server.id] } : {}) })); }
  async connection(id, signal) {
    const server = this.servers.find(item => item.id === id);
    if (!server) throw new Error('Không có MCP ' + id + '. Dùng mcp_list_servers.');
    if (!this.connections.has(id)) {
      const pending = (async () => {
        const { source, name, ...config } = server;
        const tools = new McpTools([{ ...config, connectTimeout: config.type === 'stdio' ? 90000 : 20000 }], this.secret);
        await tools.connect(signal);
        if (!tools.clients.length) { await tools.close(); throw new Error(tools.errors[0]?.error || 'Không kết nối được MCP.'); }
        return tools;
      })();
      this.connections.set(id, pending);
      pending.catch(error => { this.connections.delete(id); this.errors[id] = error.message; });
    }
    return this.connections.get(id);
  }
  async call(name, args, signal) {
    if (name === 'mcp_list_servers') return JSON.stringify({ servers: this.summary() });
    const tools = await this.connection(String(args.server || ''), signal);
    delete this.errors[args.server];
    if (name === 'mcp_list_tools') {
      const list = tools.definitions.map(tool => ({ tool: tools.routes.get(tool.name).tool, description: tool.description.replace(/^MCP [^:]+:\s*/, ''), inputSchema: tool.parameters }));
      if (args.tool) {
        const one = list.find(item => item.tool === args.tool);
        if (!one) throw new Error('MCP ' + args.server + ' không có tool ' + args.tool + '.');
        return JSON.stringify({ server: args.server, ...one });
      }
      // Compact index so large servers (Unity, video) never overflow the model context.
      return JSON.stringify({ server: args.server, total: list.length, hint: 'Call mcp_list_tools with tool for the input schema.', tools: list.map(item => ({ tool: item.tool, description: item.description.split('\n')[0].slice(0, 160) })) });
    }
    const entry = [...tools.routes].find(([, route]) => route.tool === args.tool);
    if (!entry) throw new Error('MCP ' + args.server + ' không có tool ' + args.tool + '. Dùng mcp_list_tools.');
    return tools.call(entry[0], args.arguments && typeof args.arguments === 'object' ? args.arguments : {}, signal);
  }
  async close() {
    const all = [...this.connections.values()]; this.connections.clear();
    await Promise.allSettled(all.map(pending => pending.then(tools => tools.close())));
  }
}

module.exports = { McpHub, HUB_TOOLS };
