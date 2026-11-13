import { checkPostingLimit } from '../../../lib/designated-agent-drafts.js';
import { hasInternalDraftAccess } from '../../../lib/internal-auth.js';
import { config, json, serviceHeaders } from '../../../lib/loopgram-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method_not_allowed' });
  if (!hasInternalDraftAccess(req)) return json(res, 401, { success: false, error: 'unauthorized' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });
  const draftId = String(req.query?.draft_id || '').trim();
  if (!uuid.test(draftId)) return json(res, 400, { success: false, error: 'invalid_draft_id' });

  const draftResponse = await fetch(`${cfg.url}/rest/v1/drafts?select=id,agent_id,status&id=eq.${draftId}&limit=1`, { headers: serviceHeaders(cfg.key) });
  const draftRows = await draftResponse.json().catch(() => []);
  const draft = Array.isArray(draftRows) ? draftRows[0] : null;
  if (!draftResponse.ok) return json(res, 502, { success: false, error: 'draft_read_failed' });
  if (!draft) return json(res, 404, { success: false, error: 'draft_not_found' });
  if (draft.status !== 'approved') return json(res, 409, { success: false, error: 'draft_not_approved', allowed: false });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const historyResponse = await fetch(`${cfg.url}/rest/v1/published_posts?select=published_at,drafts!inner(agent_id)&drafts.agent_id=eq.${draft.agent_id}&published_at=gte.${encodeURIComponent(since.toISOString())}&order=published_at.desc`, {
    headers: serviceHeaders(cfg.key)
  });
  const history = await historyResponse.json().catch(() => []);
  if (!historyResponse.ok) return json(res, 502, { success: false, error: 'posting_history_read_failed' });
  const publishedAt = history.map(row => row.published_at);

  const policy = checkPostingLimit(publishedAt);
  return json(res, 200, { success: true, draft_id: draftId, ...policy, publication_attempted: false });
}
