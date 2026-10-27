'use strict';
const { normalizeUsage } = require('./usage');
const { setTimeout: delay } = require('node:timers/promises');
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const { pngInfo, isImageModel } = require('./images');

function normalizeBase(value) {
  const url = new URL(String(value).trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL phải là http(s), không chứa key, query hay thông tin đăng nhập.');
  }
  url.pathname = url.pathname.replace(/\/(?:models|responses|chat\/completions)\/?$/, '').replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function route(base, model) {
  const url = new URL(base);
  const inwave = url.hostname === 'llmproxy.inwave.vn';
  const special = inwave && /^claude-(?:opus|sonnet|haiku)-5-5$/.test(model || '');
  const claude = inwave && /^claude-/.test(model || '');
  let target = base;
  if (special) target = base.replace(/\/v1$/, '');
  else if (inwave && !/\/v1$/.test(target)) target += '/v1';
  return { base: target, userAgent: claude ? 'claude-cli' : 'PO-Team-VSCode/0.6.0', preferred: inwave ? 'responses' : 'chat' };
}

function scrub(text, key) {
  return String(text).split(key || '\u0000').join('[redacted]').slice(0, 1200);
}

class ProxyClient {
  constructor(base, key, fetcher = fetch) {
    this.base = normalizeBase(base);
    this.key = key;
    this.fetcher = fetcher;
  }

  async request(url, options = {}, signal, timeout = 120000, onRetry) {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    try {
    for (let attempt = 0; attempt < 3; attempt++) {
      combined.throwIfAborted();
      const response = await this.fetcher(url, { ...options, redirect: 'error', signal: combined,
        headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json', ...options.headers } });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    const capabilityError = /only supported on|does not support (?:this|the) (?:endpoint|operation)|not supported (?:on|for) this endpoint/i.test(data?.error?.message || data?.message || '');
    // An upstream timeout can already consume 120s. Permit one repeat within the
    // existing overall deadline instead of extending it or changing models/auth.
    const maxAttempts = response.status === 408 ? 2 : 3;
    if (RETRYABLE.has(response.status) && !capabilityError && attempt + 1 < maxAttempts) {
      const header = response.headers.get('retry-after');
      const seconds = header === null ? NaN : Number(header);
      const wait = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN;
      const waitMs = Number.isFinite(wait) ? Math.max(0, Math.min(10000, wait)) : 1000 * (attempt + 1);
      if (onRetry) await onRetry({ status: response.status, attempt: attempt + 1, nextAttempt: attempt + 2, maxAttempts, waitMs });
      await delay(waitMs, undefined, { signal: combined });
      continue;
    }
    if (!response.ok) {
      const html = /<\s*(?:!doctype|html|head|body)\b/i.test(raw);
      const detail = data?.error?.message || data?.message || (html ? 'Proxy/gateway trả trang lỗi HTML, không có kết quả model.' : raw.slice(0, 400));
      const retry = capabilityError ? ' Model không hỗ trợ endpoint này; cần dùng API đúng loại model.' : RETRYABLE.has(response.status) ? ' Đã thử ' + (attempt + 1) + ' lần. Proxy vẫn lỗi; thu gọn task hoặc để PO chọn model khác.' : '';
      const error = new Error(`HTTP ${response.status}: ${scrub(detail, this.key)}${retry}`);
      error.status = response.status;
      error.attempts = attempt + 1;
      throw error;
    }
    if (!data) throw new Error('Proxy trả dữ liệu không phải JSON. Kiểm tra base URL.');
    return data;
    }
    } catch (error) {
      if (combined.aborted) throw new Error(signal?.aborted ? 'Đã dừng tác vụ.' : 'Proxy không phản hồi trong ' + timeout / 1000 + ' giây.');
      if (error.status) throw error;
      throw new Error('Lỗi phản hồi proxy: ' + scrub(error.message, this.key));
    }
  }

  async models(signal) {
    const bases = [this.base, /\/v1$/.test(this.base) ? this.base.replace(/\/v1$/, '') : this.base + '/v1'];
    let last;
    for (const base of [...new Set(bases)]) {
      try {
        const data = await this.request(base + '/models', { headers: { 'user-agent': 'PO-Team-VSCode/0.2.0' } }, signal);
        const items = Array.isArray(data) ? data : data.data || data.models;
        if (!Array.isArray(items)) throw new Error('Endpoint /models không trả danh sách model tương thích.');
        const models = [...new Map(items.map(item => typeof item === 'string' ? { id: item } : item)
          .filter(item => typeof item?.id === 'string' && item.id.length > 0)
          .map(item => [item.id, { id: item.id, owner: String(item.owned_by || '') }])).values()]
          .sort((left, right) => left.id.localeCompare(right.id));
        if (!models.length) throw new Error('Proxy không trả model nào cho API key này.');
        this.base = base;
        return { models, base };
      } catch (error) {
        last = error;
        if (error.status === 401 || signal?.aborted) throw error;
      }
    }
    throw last;
  }

  async complete(model, messages, tools = [], signal, onRetry) {
    if (isImageModel(model)) throw new Error('Model ảnh ' + model + ' cần Images API /images/generations, không dùng Chat/Responses.');
    const selected = route(this.base, model);
    const kinds = [selected.preferred, selected.preferred === 'chat' ? 'responses' : 'chat'];
    for (const kind of kinds) {
      const toolDefinitions = tools.map(tool => kind === 'chat' ? { type: 'function', function: tool } : { type: 'function', ...tool });
      let payload;
      if (kind === 'chat') {
        payload = { model, messages, stream: false, ...(tools.length ? { tools: toolDefinitions } : {}) };
      } else {
        const input = [];
        for (const message of messages) {
          if (message.role === 'tool') input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content });
          else if (message.role === 'assistant' && message.tool_calls?.length) {
            if (message.content) input.push({ role: 'assistant', content: message.content });
            for (const call of message.tool_calls) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
          } else input.push({ role: message.role === 'system' ? 'developer' : message.role, content: Array.isArray(message.content) ? message.content.map(part => part.type === 'image_url' ? { type: 'input_image', image_url: part.image_url.url } : { type: 'input_text', text: part.text || '' }) : message.content || '' });
        }
        payload = { model, input, stream: false, store: false, ...(tools.length ? { tools: toolDefinitions } : {}) };
      }
      try {
        const data = await this.request(selected.base + (kind === 'chat' ? '/chat/completions' : '/responses'), {
          method: 'POST', headers: { 'user-agent': selected.userAgent }, body: JSON.stringify(payload)
        }, signal, 300000, onRetry);
        if (kind === 'chat') {
          const message = data.choices?.[0]?.message;
          if (!message) throw new Error('Proxy không trả message trong choices.');
          return { text: typeof message.content === 'string' ? message.content : '', calls: message.tool_calls || [], usage: normalizeUsage(data.usage) };
        }
        if (data.error) throw new Error(scrub(data.error.message, this.key));
        const output = data.output || [];
        const text = data.output_text || output.filter(item => item.type === 'message')
          .flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('\n');
        const calls = output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id,
          type: 'function', function: { name: item.name, arguments: item.arguments } }));
        if (!text && !calls.length) throw new Error('Model trả kết quả rỗng hoặc không hỗ trợ endpoint này.');
        return { text, calls, usage: normalizeUsage(data.usage) };
      } catch (error) {
        if (![404, 405, 501].includes(error.status) || kind === kinds[1]) throw error;
      }
    }
  }

  async generateImage(model, prompt, options = {}, signal, onRetry) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Prompt ảnh cần từ 1 đến 16000 ký tự.');
    const size = options.size || '1024x1024';
    const background = options.background || 'auto';
    if (!['1024x1024', '1536x1024', '1024x1536', 'auto'].includes(size) || !['transparent', 'opaque', 'auto'].includes(background)) throw new Error('Kích thước hoặc nền ảnh không hợp lệ.');
    const selected = route(this.base, model);
    const data = await this.request(selected.base + '/images/generations', { method: 'POST', headers: { 'user-agent': selected.userAgent }, body: JSON.stringify({ model, prompt, n: 1, size, quality: 'medium', background, output_format: 'png' }) }, signal, 300000, onRetry);
    const encoded = data.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > 28 * 1024 * 1024 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Image API chưa trả b64_json PNG hợp lệ. Endpoint cần hỗ trợ ảnh base64.');
    const bytes = Buffer.from(encoded, 'base64');
    return { bytes, ...pngInfo(bytes), revisedPrompt: data.data[0].revised_prompt, usage: normalizeUsage(data.usage) };
  }
}

module.exports = { ProxyClient, normalizeBase, route, scrub };
