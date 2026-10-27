'use strict';

// Connection-level failures affect every model alike; switching models cannot fix them.
const NETWORK = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|network error|UND_ERR_CONNECT/i;
function isNetworkError(value) {
  const text = String(value?.message || value || '');
  return value?.status === 401 || /^HTTP 401\b/.test(text) || NETWORK.test(text);
}

function diagnose(value) {
  const text = String(value?.message || value || '');
  const status = value?.status || Number(text.match(/\bHTTP\s+(\d{3})\b/i)?.[1]) || undefined;
  if (/Bị chặn: việc phụ thuộc/i.test(text)) return { kind: 'dependency_blocked', retryable: false, message: 'Đang chờ sửa task phụ thuộc.' };
  if (!status && NETWORK.test(text)) return { kind: 'network', retryable: false, message: 'Mất kết nối tới proxy. App chờ mạng rồi làm tiếp bằng model hiện tại.' };
  if (status === 408 || /litellm\.Timeout|Proxy không phản hồi trong/i.test(text)) {
    const seconds = text.match(/Timeout passed[=:]\s*([\d.]+)/i)?.[1];
    return { kind: 'proxy_timeout', status, retryable: true, message: 'Proxy/model hết thời gian chờ' + (seconds ? ' (' + Number(seconds) + ' giây)' : '') + '. Xem log; thu gọn task hoặc để PO chọn model khác.' };
  }
  if ([401, 403].includes(status)) return { kind: 'proxy_access', status, retryable: false, message: 'Proxy từ chối quyền truy cập (HTTP ' + status + '). Kiểm tra quyền model và cấu hình kết nối trong log.' };
  if (status === 429 || status >= 500) return { kind: 'proxy_unavailable', status, retryable: true, message: 'Proxy chưa phục vụ được yêu cầu (HTTP ' + status + '). Xem log và kết quả thử lại.' };
  return { kind: status ? 'http_error' : 'task_error', status, retryable: false, message: text.length > 240 ? text.slice(0, 237) + '…' : text };
}

class ErrorNotices {
  constructor() { this.sessions = new Map(); }
  next(runId, event) {
    if (event.type !== 'error') return null;
    const diagnostic = diagnose(event.text);
    if (event.code === 'dependency_blocked' || diagnostic.kind === 'dependency_blocked') return null;
    if (!this.sessions.has(runId)) {
      if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value);
      this.sessions.set(runId, new Set());
    }
    const seen = this.sessions.get(runId);
    const key = JSON.stringify([event.model || event.agent, diagnostic.kind, diagnostic.status, ['http_error', 'task_error'].includes(diagnostic.kind) ? diagnostic.message : '']);
    if (seen.has(key)) return null;
    seen.add(key);
    return diagnostic.message + ' Lỗi đầy đủ và các việc bị ảnh hưởng nằm trong Log trực tiếp.';
  }
}

function completionNotice(state, event) {
  const pending = (state?.tasks || []).filter(task => ['error', 'rework', 'stopped', 'paused'].includes(task.status)).length;
  const warning = event.approved === false || pending > 0 || /cần xử lý|do lỗi|Đã dừng/i.test(event.text || '');
  return { warning, text: warning ? 'PO Team chưa hoàn tất: ' + (pending ? pending + ' việc cần xử lý. ' : '') + 'Xem Kết quả / Log trực tiếp.' : 'PO Team xong: ' + (state?.title || '') + (event.text ? ' — ' + event.text : '') };
}

module.exports = { diagnose, isNetworkError, ErrorNotices, completionNotice };
