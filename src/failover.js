'use strict';
const { isImageModel } = require('./images');

// Preferred replacement order inside a price tier; other catalog models follow.
const PREFERRED = ['gpt-6.1-sol', 'claude-opus-5-5', 'gpt-6-astra', 'cx/gpt-5.6-sol', 'claude-sonnet-5-5', 'cx/gpt-5.6-terra', 'gpt-6.1-astra', 'cx/gpt-5.5', 'gpt-6.1-luna', 'claude-haiku-5-5', 'cx/gpt-5.6-luna'];
const NON_CHAT = /(?:embed|whisper|tts|moderation|transcri|rerank)/i;
// Cost guard: each role may switch model at most 3 times per recovery cycle, the whole session 8 times.
const MAX_ROLE_SWITCHES = 3, MAX_SESSION_SWITCHES = 8;
const ids = models => (models || []).map(model => typeof model === 'string' ? model : model?.id).filter(Boolean);

// Approximate price tier from the model name: 1 cheap, 2 standard, 3 premium.
function tier(model) {
  const id = String(model || '').toLowerCase();
  if (/luna|haiku|mini|nano|flash|lite/.test(id)) return 1;
  if (/opus|(?:^|[-/.])sol(?:$|[-/.])|astra|(?:^|-)pro(?:$|-)|ultra/.test(id)) return 3;
  return 2;
}

// Next untried model of the same kind. Same price tier first, then cheaper; a more
// expensive tier only when nothing else remains, so a failure never silently raises cost.
function nextModel(current, models, tried = []) {
  const image = isImageModel(current), base = tier(current);
  const skip = new Set([current, ...tried]);
  const usable = ids(models).filter(id => !skip.has(id) && !NON_CHAT.test(id) && isImageModel(id) === image);
  const ordered = [...PREFERRED.filter(id => usable.includes(id)), ...usable.filter(id => !PREFERRED.includes(id))];
  const rank = id => { const t = tier(id); return t === base ? 0 : t < base ? base - t : 10 + t - base; };
  return ordered.map((id, index) => ({ id, key: rank(id) * 1000 + index })).sort((a, b) => a.key - b.key)[0]?.id || null;
}

module.exports = { nextModel, tier, MAX_ROLE_SWITCHES, MAX_SESSION_SWITCHES };
