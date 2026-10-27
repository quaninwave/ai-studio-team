'use strict';

const SOL_MODEL = 'gpt-6.1-sol';
const isOpus = model => /^claude-opus-/.test(model || '');
const hasSol = models => (models || []).some(model => (model.id || model) === SOL_MODEL);

function restoreLeadership(value) {
  return {
    consecutiveFailures: Math.min(3, Math.max(0, Number.isInteger(value?.consecutiveFailures) ? value.consecutiveFailures : 0)),
    failedModel: typeof value?.failedModel === 'string' ? value.failedModel : '',
    lastFailure: value?.lastFailure || null,
    triedModels: Array.isArray(value?.triedModels) ? value.triedModels.filter(item => typeof item === 'string').slice(-20) : [],
    handoffs: Array.isArray(value?.handoffs) ? value.handoffs.slice(-20) : []
  };
}

function modelRecommendations(value, roles, coordinator, models) {
  // Tech may suggest any text model in the catalog that differs from the role's current model.
  const catalog = new Set((models || []).map(model => model.id || model).filter(id => typeof id === 'string' && !/image/i.test(id)));
  return (Array.isArray(value) ? value : []).slice(0, 8).filter(item => item &&
    catalog.has(item.model) && typeof item.reason === 'string' && item.reason.trim() &&
    (item.roleId === 'lead' ? coordinator : roles.find(role => role.id === item.roleId)?.model) &&
    item.model !== (item.roleId === 'lead' ? coordinator : roles.find(role => role.id === item.roleId)?.model)
  ).map(item => ({ roleId: item.roleId, model: item.model, reason: item.reason.trim().slice(0, 1000) }));
}

module.exports = { SOL_MODEL, isOpus, hasSol, restoreLeadership, modelRecommendations };
