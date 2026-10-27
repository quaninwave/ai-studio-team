'use strict';
const crypto = require('crypto');
const { workspaceTool } = require('./workspace');
const { isImageModel, stageImage } = require('./images');
const CONCEPT_PROMPT = `You are the PO presenting a proposal to the CEO BEFORE detailed delegation. Inspect a small relevant project sample using read-only tools. Explain your reasoning, existing game vibe, what will change, what is retained, a concrete playable example, and risks. Offer 1-3 distinct feasible directions. Do NOT create roles or tasks yet. Return ONLY JSON {"understanding":"clear interpretation","findings":"observed source and unknowns","recommendation":"recommended option and reasoning","options":[{"id":"cute_halloween","title":"...","rationale":"why it fits","experience":"concrete demo walkthrough for the user","deliverables":["..."],"assumptions":["..."],"risks":["..."],"estimate":{"minMinutes":15,"maxMinutes":30,"basis":"assumptions: max 3 parallel positions, source inspection, patches, actual generation/import/test tools; exclude CEO waiting","confidence":"low|medium|high"},"demoPrompt":"detailed concept image prompt, same game vibe, no text/watermark, not proof of a running build"}]}. Estimates are provisional ranges, not promises. Account for proxy latency and tool limitations. A concept image is illustrative; do not claim production assets or a playable level exist. Never invent tool availability. Use the user's language.`;
function validateConcept(input) {
  const string = (value, max = 5000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Nội dung đề xuất PO không hợp lệ.'); return value.trim(); };
  const list = values => { if (!Array.isArray(values) || values.length > 12) throw new Error('Danh sách đề xuất không hợp lệ.'); return values.map(value => string(value, 1800)); };
  if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 3) throw new Error('PO cần đề xuất 1–3 hướng.');
  const ids = new Set();
  return { understanding: string(input.understanding), findings: string(input.findings), recommendation: string(input.recommendation), options: input.options.map(option => {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(option.id || '') || ids.has(option.id)) throw new Error('ID hướng làm không hợp lệ/trùng.');
    ids.add(option.id);
    const estimate = option.estimate;
    if (!estimate || !Number.isFinite(estimate.minMinutes) || !Number.isFinite(estimate.maxMinutes) || estimate.minMinutes < 1 || estimate.maxMinutes < estimate.minMinutes || estimate.maxMinutes > 1440) throw new Error('Ước tính PO cần khoảng phút hợp lệ.');
    return { id: option.id, title: string(option.title, 200), rationale: string(option.rationale), experience: string(option.experience), deliverables: list(option.deliverables), assumptions: list(option.assumptions), risks: list(option.risks), estimate: { minMinutes: estimate.minMinutes, maxMinutes: estimate.maxMinutes, basis: string(estimate.basis), confidence: ['low', 'medium', 'high'].includes(estimate.confidence) ? estimate.confidence : 'low' }, demoPrompt: typeof option.demoPrompt === 'string' ? option.demoPrompt.slice(0, 12000) : '' };
  }) };
}
async function propose(r, request, models, parseObject) {
  r.request = request; r.models = models; r.phase = 'concept_planning';
  await r.event('lead', 'team', { coordinator: 'lead', members: [{ id: 'lead', name: 'PO · Đề xuất', model: r.roles.lead }] });
  await r.event('lead', 'start', { title: r.sessionTitle || request.slice(0, 90), text: 'PO trình bày hướng làm trước khi chia team' });
  await r.saveState();
  try {
    const workspace = r.root ? await workspaceTool(r.root, 'list_files', { path: '' }) : 'No workspace authorized; analysis only.';
    const text = await r.ask('lead', CONCEPT_PROMPT, JSON.stringify({ request, workspace, models, mcp: r.mcp?.definitions || [], unavailableTools: r.mcp?.errors || [] }), !!r.root);
    r.concept = { ...validateConcept(parseObject(text)), createdAt: new Date().toISOString(), approved: null };
    r.phase = 'awaiting_concept'; await r.saveState();
    await r.event('lead', 'note', { text: 'Đề xuất đã sẵn sàng. CEO chọn hướng trước khi PO phân công.' });
    return r.concept;
  } catch (error) { await r.fail(error); if (r.pauseRequested || error.code === 'SESSION_HOLD') return null; throw error; }
}
async function previewConcept(r, optionId, model) {
  if (r.phase !== 'awaiting_concept') throw new Error('Chỉ tạo demo khi đang chọn hướng.');
  const option = r.concept?.options.find(option => option.id === optionId);
  if (!option?.demoPrompt || !isImageModel(model) || !r.models.some(item => (item.id || item) === model)) throw new Error('Chọn hướng và model ảnh hợp lệ từ proxy.');
  const previous = option.preview;
  try {
    option.preview = { status: 'generating', model }; await r.saveState();
    const generated = await r.measured('lead', 'image', retry => r.client.generateImage(model, option.demoPrompt, { size: '1536x1024', background: 'opaque' }, r.abort.signal, retry), model);
    option.preview = { ...await stageImage(r.directory, r.run, generated), status: 'ready', model, prompt: option.demoPrompt };
    await r.saveState(); await r.event('lead', 'note', { text: 'Đã tạo ảnh minh họa hướng ' + option.title + '; chưa phải game chạy thật.' });
  } catch (error) { option.preview = previous?.artifact ? previous : { status: 'error', error: error.message }; await r.saveState(); throw error; }
}
async function refineConcept(r, parseObject) {
  let changed = false;
  for (;;) {
    const messages = r.control.messages.filter(item => item.role === 'user' && item.status === 'queued');
    if (!messages.length) return changed;
    r.phase = 'concept_planning'; await r.saveState();
    try {
      const response = await r.ask('lead', CONCEPT_PROMPT + '\nRevise the proposal using the CEO conversation. Preserve the original objective unless the CEO changes it. Still do not delegate. Previously generated previews may be obsolete; do not reuse them for a different direction.', JSON.stringify({ request: r.request, previousConcept: r.concept, conversation: r.control.context(), messages, models: r.models }), !!r.root);
      r.concept = { ...validateConcept(parseObject(response)), createdAt: new Date().toISOString(), approved: null };
      for (const message of messages) { message.status = 'processed'; delete message.error; }
      r.control.messages.push({ id: crypto.randomUUID(), role: 'assistant', text: r.concept.recommendation + '\nĐã cập nhật đề xuất. Mở Đề xuất để xem demo, thời gian và chọn hướng.', replyTo: messages.at(-1).id, model: r.roles.lead, createdAt: new Date().toISOString(), status: 'processed' });
      changed = true;
    } catch (error) {
      if (error.code === 'SESSION_HOLD' || r.abort.signal.aborted) throw error;
      for (const message of messages) { message.status = 'error'; message.error = error.message; }
      await r.event('lead', 'error', { text: 'Chưa cập nhật được đề xuất: ' + error.message });
    }
    r.phase = 'awaiting_concept'; await r.saveState();
  }
}
module.exports = { propose, previewConcept, validateConcept, refineConcept };
