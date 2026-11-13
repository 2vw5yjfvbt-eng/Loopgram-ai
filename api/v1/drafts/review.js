import { hasInternalDraftAccess } from '../../../lib/internal-auth.js';
import { config, json, serviceHeaders } from '../../../lib/loopgram-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parseBody = req => {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method_not_allowed' });
  if (!hasInternalDraftAccess(req)) return json(res, 401, { success: false, error: 'unauthorized' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });
  const body = parseBody(req);
  const draftId = String(body.draft_id || '').trim();
  const action = String(body.action || '').trim();
  const actor = String(body.actor || '').trim().slice(0, 200);
  const notes = body.notes == null ? null : String(body.notes).trim().slice(0, 2000);
  const editedText = body.proposed_post_text == null ? null : String(body.proposed_post_text).trim().slice(0, 2000);

  if (!uuid.test(draftId)) return json(res, 400, { success: false, error: 'invalid_draft_id' });
  if (!['approved', 'rejected', 'edited'].includes(action)) return json(res, 400, { success: false, error: 'invalid_action' });
  if (!actor) return json(res, 400, { success: false, error: 'actor_required' });
  if (action === 'edited' && !editedText) return json(res, 400, { success: false, error: 'edited_text_required' });

  const reviewResponse = await fetch(`${cfg.url}/rest/v1/rpc/review_designated_agent_draft`, {
    method: 'POST',
    headers: serviceHeaders(cfg.key),
    body: JSON.stringify({
      p_draft_id: draftId,
      p_actor: actor,
      p_action: action,
      p_notes: notes,
      p_proposed_post_text: editedText
    })
  });
  const updatedRows = await reviewResponse.json().catch(() => []);
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
  if (!reviewResponse.ok || !updated) return json(res, 409, { success: false, error: 'draft_review_failed' });

  return json(res, 200, { success: true, draft: updated, publication_attempted: false });
}
