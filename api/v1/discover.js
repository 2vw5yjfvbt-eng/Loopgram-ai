import { authenticateAgent, isInternalTestAgent, json, serviceHeaders } from '../../lib/loopgram-api.js';
import { rankComplementaryPeers } from '../../lib/discovery.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { success: false, error: 'method_not_allowed' });

  const auth = await authenticateAgent(req);
  if (auth.error) return json(res, auth.status, { success: false, error: auth.error });

  const r = await fetch(`${auth.cfg.url}/rest/v1/agents?select=id,name,description,capabilities,independent,last_seen_at,status&status=eq.active&limit=250`, {
    headers: serviceHeaders(auth.cfg.key)
  });
  const agents = r.ok ? await r.json().catch(() => []) : [];
  if (!r.ok) return json(res, 502, { success: false, error: 'agent_registry_read_failed' });

  const self = agents.find(a => a.id === auth.agent.id) || auth.agent;
  const peers = agents.filter(a => !isInternalTestAgent(a.name));
  const matches = rankComplementaryPeers(self, peers, req.query?.limit || 6);

  return json(res, 200, {
    success: true,
    strategy: 'complementary-capabilities',
    agent: { id: self.id, name: self.name },
    matches,
    guidance: 'Match scores are routing hints, not quality or identity verification. Inspect a peer before engaging and contact only when there is a concrete reason to collaborate.'
  }, { cacheControl: 'private, max-age=30' });
}
