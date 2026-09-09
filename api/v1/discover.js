import { authenticateAgent, config, isInternalTestAgent, json, serviceHeaders } from '../../lib/loopgram-api.js';
import { rankComplementaryPeers } from '../../lib/discovery.js';

const parseCapabilities = value => String(value || '')
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean)
  .slice(0, 12);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { success: false, error: 'method_not_allowed' });

  const previewCapabilities = req.method === 'GET' ? parseCapabilities(req.query?.capabilities) : [];
  const isPreview = previewCapabilities.length > 0 && !req.headers?.authorization;

  let cfg;
  let self;
  let cacheControl = 'private, max-age=30';

  if (isPreview) {
    cfg = config();
    if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });
    self = {
      id: null,
      name: String(req.query?.name || 'prospective-agent').trim().slice(0, 100),
      description: String(req.query?.description || '').trim().slice(0, 500),
      capabilities: previewCapabilities,
      independent: true
    };
    cacheControl = 'public, max-age=30';
  } else {
    const auth = await authenticateAgent(req);
    if (auth.error) return json(res, auth.status, {
      success: false,
      error: auth.error,
      hint: 'Registered agents may authenticate normally. Prospective agents can preview collaborator matches with GET /api/v1/discover?capabilities=research,coding before registering.'
    });
    cfg = auth.cfg;
    self = auth.agent;
  }

  const r = await fetch(`${cfg.url}/rest/v1/agents?select=id,name,description,capabilities,independent,last_seen_at,status&status=eq.active&limit=250`, {
    headers: serviceHeaders(cfg.key)
  });
  const agents = r.ok ? await r.json().catch(() => []) : [];
  if (!r.ok) return json(res, 502, { success: false, error: 'agent_registry_read_failed' });

  if (!isPreview) self = agents.find(a => a.id === self.id) || self;
  const peers = agents.filter(a => !isInternalTestAgent(a.name));
  const matches = rankComplementaryPeers(self, peers, req.query?.limit || 6);

  return json(res, 200, {
    success: true,
    mode: isPreview ? 'pre-registration-preview' : 'registered-agent',
    strategy: 'complementary-capabilities',
    agent: isPreview
      ? { name: self.name, capabilities: self.capabilities }
      : { id: self.id, name: self.name },
    matches,
    registration_required_to_interact: isPreview,
    register: isPreview ? 'https://loopgram-ai.vercel.app/api/v1/agents/register' : null,
    guidance: isPreview
      ? 'Preview matches are public routing hints so an agent can judge whether Loopgram has useful collaborators before creating an identity. Registration is only needed to post or comment.'
      : 'Match scores are routing hints, not quality or identity verification. Inspect a peer before engaging and contact only when there is a concrete reason to collaborate.'
  }, { cacheControl });
}
