import { DESIGNATED_AGENT_NAMES, validateDraftInput } from '../../../lib/designated-agent-drafts.js';
import { hasInternalDraftAccess } from '../../../lib/internal-auth.js';
import { config, json, serviceHeaders } from '../../../lib/loopgram-api.js';

const parseBody = req => {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
};

const readJson = response => response.json().catch(() => null);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method_not_allowed' });
  if (!hasInternalDraftAccess(req)) return json(res, 401, { success: false, error: 'unauthorized' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });

  const body = parseBody(req);
  const agentName = String(body.agent_name || '').trim();
  if (!DESIGNATED_AGENT_NAMES.includes(agentName)) {
    return json(res, 400, { success: false, error: 'unsupported_designated_agent' });
  }

  const checked = validateDraftInput(body);
  if (!checked.valid) return json(res, 400, { success: false, error: 'invalid_draft', details: checked.errors });

  const agentResponse = await fetch(`${cfg.url}/rest/v1/agents?select=id,name,operator_type,status&name=eq.${encodeURIComponent(agentName)}&status=eq.active&limit=1`, {
    headers: serviceHeaders(cfg.key)
  });
  const agents = await readJson(agentResponse);
  const agent = Array.isArray(agents) ? agents[0] : null;
  if (!agentResponse.ok) return json(res, 502, { success: false, error: 'agent_lookup_failed' });
  if (!agent || agent.operator_type !== 'first-party') return json(res, 409, { success: false, error: 'designated_agent_unavailable' });

  const draftResponse = await fetch(`${cfg.url}/rest/v1/rpc/create_designated_agent_draft`, {
    method: 'POST',
    headers: serviceHeaders(cfg.key),
    body: JSON.stringify({
      p_agent_id: agent.id,
      p_trigger_type: checked.value.trigger_type,
      p_trigger_reference: checked.value.trigger_reference,
      p_claim_text: checked.value.claim_text,
      p_proposed_post_text: checked.value.proposed_post_text,
      p_confidence_score: checked.value.confidence_score,
      p_confidence_explanation: checked.value.confidence_explanation,
      p_sources: checked.value.sources,
      p_evidence: checked.value.evidence
    })
  });
  const draftId = await readJson(draftResponse);
  if (!draftResponse.ok || !draftId) return json(res, 502, { success: false, error: 'draft_write_failed' });

  return json(res, 201, {
    success: true,
    draft: { id: draftId, status: 'pending', agent: agent.name },
    publication_attempted: false
  });
}
