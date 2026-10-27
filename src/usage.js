'use strict';
const crypto = require('crypto');
const count = value => Number.isFinite(value) && value >= 0 ? value : null;
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { input: count(raw.input_tokens ?? raw.prompt_tokens), output: count(raw.output_tokens ?? raw.completion_tokens), cached: count(raw.input_tokens_details?.cached_tokens ?? raw.prompt_tokens_details?.cached_tokens), reasoning: count(raw.output_tokens_details?.reasoning_tokens ?? raw.completion_tokens_details?.reasoning_tokens) };
}
function hold(reason) { return Object.assign(new Error(reason), { code: 'SESSION_HOLD' }); }
function settings(value = {}) {
  const limit = key => { const v = value[key]; if (v === '' || v == null || v === 0) return null; if (!Number.isSafeInteger(v) || v < 1) throw new Error('Ngân sách phải là số nguyên dương, hoặc 0 để bỏ giới hạn.'); return v; };
  const prices = {};
  if (!value.prices || typeof value.prices !== 'object' || Array.isArray(value.prices)) value = { ...value, prices: {} };
  for (const [model, price] of Object.entries(value.prices).slice(0, 500)) {
    if (!price || typeof price !== 'object') throw new Error('Bảng giá không hợp lệ.');
    const entry = {};
    for (const key of ['input', 'output', 'cached', 'image']) if (price[key] != null) { if (count(price[key]) == null) throw new Error('Giá phải là số không âm.'); entry[key] = price[key]; }
    prices[model] = entry;
  }
  return { maxCalls: limit('maxCalls'), maxTokens: limit('maxTokens'), currency: typeof value.currency === 'string' ? value.currency.slice(0, 12) : 'USD', prices };
}
class UsageLedger {
  constructor(data = {}) {
    this.settings = settings(data.settings);
    // Requests left open by a crashed host may have been billed. Never replay them as known zero usage.
    this.records = (Array.isArray(data.records) ? data.records : []).map(record => record.status === 'running' ? { ...record, status: 'interrupted', usage: null } : record);
  }
  configure(value) { this.settings = settings(value); }
  snapshot() { return { settings: this.settings, records: this.records, summary: this.summary() }; }
  summary() {
    const rows = new Map();
    for (const record of this.records) {
      const key = JSON.stringify([record.agent, record.model]);
      const row = rows.get(key) || { agent: record.agent, model: record.model, calls: 0, retries: 0, durationMs: 0, input: 0, output: 0, missingUsage: 0, failures: 0, images: 0, estimatedCost: 0, unpriced: 0 };
      row.calls++; row.retries += record.retries || 0; row.durationMs += record.durationMs || 0;
      if (!['success', 'running'].includes(record.status)) row.failures++;
      row.images += record.images || 0;
      const usage = record.usage;
      if (usage?.input == null || usage?.output == null || record.retries > 0 || record.status === 'running') row.missingUsage++;
      row.input += usage?.input || 0; row.output += usage?.output || 0;
      const price = this.settings.prices[record.model];
      if (record.images && price?.image != null) row.estimatedCost += record.images * price.image;
      else if (record.kind !== 'image' && price?.input != null && price?.output != null && usage?.input != null && usage?.output != null) {
        const cached = Math.min(usage.cached || 0, usage.input);
        row.estimatedCost += ((usage.input - cached) * price.input + cached * (price.cached ?? price.input) + usage.output * price.output) / 1e6;
      } else row.unpriced++;
      rows.set(key, row);
    }
    const models = [...rows.values()];
    return { models, calls: this.records.length, tokens: models.reduce((n, row) => n + row.input + row.output, 0), missingUsage: models.reduce((n, row) => n + row.missingUsage, 0), estimatedCost: models.reduce((n, row) => n + row.estimatedCost, 0), unpriced: models.reduce((n, row) => n + row.unpriced, 0) };
  }
  begin(agent, model, kind = 'text') {
    const summary = this.summary(), limits = this.settings;
    if (limits.maxCalls && summary.calls >= limits.maxCalls) throw hold('Đã đạt ngân sách lượt gọi. Tăng giới hạn trong Tài nguyên rồi Tiếp tục.');
    if (limits.maxTokens && summary.tokens >= limits.maxTokens) throw hold('Đã đạt ngân sách token đã biết. Tăng giới hạn trong Tài nguyên rồi Tiếp tục.');
    const record = { id: crypto.randomUUID(), agent, model, kind, startedAt: new Date().toISOString(), status: 'running', retries: 0, usage: null };
    this.records.push(record); return record;
  }
  finish(record, response, error) {
    record.durationMs = Date.now() - Date.parse(record.startedAt); record.status = error ? 'failed' : 'success';
    record.usage = response?.usage || null; record.images = !error && record.kind === 'image' ? 1 : 0;
  }
}
module.exports = { UsageLedger, normalizeUsage, settings, hold };
