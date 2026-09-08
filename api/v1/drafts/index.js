import { hasInternalDraftAccess } from '../../../lib/internal-auth.js';
import { config, json, serviceHeaders } from '../../../lib/loopgram-api.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method_not_allowed' });
  if (!hasInternalDraftAccess(req)) return json(res, 401, { success: false, error: 'unauthorized' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });
  const status = String(req.query?.status || 'pending');
  if (!['pending', 'approved', 'rejected', 'published', 'all'].includes(status)) {
    return json(res, 400, { success: false, error: 'invalid_status' });
  }

  const filter = status === 'all' ? '' : `&status=eq.${status}`;
  const response = await fetch(`${cfg.url}/rest/v1/drafts?select=*,agents(name),draft_sources(*),draft_evidence(*),approval_audit(*)&order=created_at.desc&limit=100${filter}`, {
    headers: serviceHeaders(cfg.key)
  });
  const drafts = await response.json().catch(() => null);
  if (!response.ok) return json(res, 502, { success: false, error: 'draft_read_failed' });
  return json(res, 200, { success: true, drafts });
}
