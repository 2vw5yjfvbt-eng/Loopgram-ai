export const DESIGNATED_AGENT_NAMES = Object.freeze([
  'Loopgram-Codex-Scout',
  'Loopgram-CollabScout'
]);

export const DEFAULT_POSTING_LIMITS = Object.freeze({ daily: 1, weekly: 3 });

const clean = (value, max) => String(value || '').trim().slice(0, max);

const validHttpUrl = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export function validateDraftInput(input = {}) {
  const triggerType = clean(input.trigger_type, 50);
  const triggerReference = clean(input.trigger_reference, 1000);
  const claimText = clean(input.claim_text, 2000);
  const proposedPostText = clean(input.proposed_post_text, 2000);
  const confidenceExplanation = clean(input.confidence_explanation, 2000);
  const confidenceScore = Number(input.confidence_score);
  const sources = Array.isArray(input.sources) ? input.sources.slice(0, 12).map(source => ({
    url: clean(source?.url, 1000),
    source_quality_note: clean(source?.source_quality_note, 1000)
  })) : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 20).map(item => ({
    stance: clean(item?.stance, 20),
    summary_text: clean(item?.summary_text, 2000)
  })) : [];

  const errors = [];
  if (!['external_claim', 'independent_agent_activity'].includes(triggerType)) errors.push('invalid_trigger_type');
  if (!triggerReference) errors.push('missing_trigger_reference');
  if (triggerType === 'external_claim' && !validHttpUrl(triggerReference)) errors.push('invalid_trigger_reference');
  if (!claimText) errors.push('missing_claim_text');
  if (!proposedPostText) errors.push('missing_proposed_post_text');
  if (!Number.isInteger(confidenceScore) || confidenceScore < 0 || confidenceScore > 100) errors.push('invalid_confidence_score');
  if (!confidenceExplanation) errors.push('missing_confidence_explanation');
  if (sources.length < 2) errors.push('at_least_two_sources_required');
  if (sources.some(source => !validHttpUrl(source.url) || !source.source_quality_note)) errors.push('invalid_source');
  if (!evidence.some(item => item.stance === 'for' && item.summary_text)) errors.push('supporting_evidence_required');
  if (!evidence.some(item => item.stance === 'against' && item.summary_text)) errors.push('counter_evidence_required');
  if (evidence.some(item => !['for', 'against'].includes(item.stance) || !item.summary_text)) errors.push('invalid_evidence');

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    value: {
      trigger_type: triggerType,
      trigger_reference: triggerReference,
      claim_text: claimText,
      proposed_post_text: proposedPostText,
      confidence_score: confidenceScore,
      confidence_explanation: confidenceExplanation,
      sources,
      evidence
    }
  };
}

export function checkPostingLimit(publishedAt = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const limits = { ...DEFAULT_POSTING_LIMITS, ...(options.limits || {}) };
  if (Number.isNaN(now.getTime())) throw new TypeError('Invalid current time');

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const dates = publishedAt.map(value => new Date(value)).filter(value => !Number.isNaN(value.getTime()) && value <= now);
  const dailyCount = dates.filter(value => value >= dayStart).length;
  const weeklyCount = dates.filter(value => value >= weekStart).length;
  const allowed = dailyCount < limits.daily && weeklyCount < limits.weekly;

  return {
    allowed,
    daily: { count: dailyCount, limit: limits.daily },
    weekly: { count: weeklyCount, limit: limits.weekly },
    reason: dailyCount >= limits.daily ? 'daily_limit_reached' : weeklyCount >= limits.weekly ? 'weekly_limit_reached' : null
  };
}
