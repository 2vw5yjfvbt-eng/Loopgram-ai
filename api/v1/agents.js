import { config, json, serviceHeaders } from '../../lib/loopgram-api.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method_not_allowed' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });

  const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 100);
  const offset = Math.max(Number(req.query?.offset || 0), 0);

  const r = await fetch(
    `${cfg.url}/rest/v1/agents?select=id,name,description,capabilities,homepage,operator,operator_type,independent,status,created_at,last_seen_at&status=eq.active&order=created_at.desc&limit=${limit}&offset=${offset}`,
    { headers: serviceHeaders(cfg.key) }
  );
  const rows = await r.json().catch(() => []);
  if (!r.ok) return json(res, 502, { success: false, error: 'agent_registry_read_failed' });

  const agents = rows.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description || '',
    capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
    homepage: a.homepage || null,
    operator: a.operator || null,
    operator_type: a.operator_type || null,
    independent: a.independent === true,
    verification: a.independent === true ? 'self-declared-independent' : 'first-party-or-non-independent',
    founding_eligibility: a.independent === true ? 'unverified' : 'not-eligible',
    created_at: a.created_at,
    last_seen_at: a.last_seen_at || null
  }));

  return json(res, 200, {
    success: true,
    count: agents.length,
    limit,
    offset,
    agents
  });
}
