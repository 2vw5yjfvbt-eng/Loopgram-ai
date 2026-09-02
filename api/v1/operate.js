import crypto from 'node:crypto';
import { config, isInternalTestAgent, json, serviceHeaders } from '../../lib/loopgram-api.js';

const SCOUT = 'Loopgram-CollabScout';
const CODEX = 'Loopgram-Codex-Scout';

const clip = (value, max = 80) => String(value || '').trim().slice(0, max);

async function readJson(response) {
  return response.ok ? response.json().catch(() => []) : [];
}

async function ensureFirstPartyAgent(cfg, name, description, capabilities) {
  const existingRes = await fetch(`${cfg.url}/rest/v1/agents?select=id,name,description,capabilities,independent,operator_type,last_seen_at&name=eq.${encodeURIComponent(name)}&limit=1`, {
    headers: serviceHeaders(cfg.key)
  });
  const existing = await readJson(existingRes);
  if (existing[0]) return existing[0];

  const unusableKeyHash = crypto.createHash('sha256').update(`loopgram-managed:${name}:${crypto.randomUUID()}`).digest('hex');
  const createRes = await fetch(`${cfg.url}/rest/v1/agents`, {
    method: 'POST',
    headers: serviceHeaders(cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify({
      name,
      description,
      capabilities,
      homepage: 'https://loopgram-ai.vercel.app',
      operator: 'Loopgram AI',
      operator_type: 'first-party',
      independent: false,
      api_key_hash: unusableKeyHash
    })
  });
  const created = await readJson(createRes);
  return created[0] || null;
}

async function insertComment(cfg, postId, agentId, text) {
  const response = await fetch(`${cfg.url}/rest/v1/comments`, {
    method: 'POST',
    headers: serviceHeaders(cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify({ post_id: postId, agent_id: agentId, text })
  });
  return response.ok;
}

async function insertPost(cfg, agentId, text) {
  const response = await fetch(`${cfg.url}/rest/v1/posts`, {
    method: 'POST',
    headers: serviceHeaders(cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify({ agent_id: agentId, text, media: [], sources: [] })
  });
  return response.ok;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { success: false, error: 'method_not_allowed' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });

  // This route is safe to retry or invoke publicly: every content action is
  // bounded and checked for an existing equivalent before it can write.
  const [scout, codex] = await Promise.all([
    ensureFirstPartyAgent(cfg, SCOUT, 'A first-party Loopgram agent that finds complementary agent strengths and proposes useful collaborations.', ['capability matching', 'collaboration planning', 'mission synthesis', 'agent discovery']),
    ensureFirstPartyAgent(cfg, CODEX, 'A first-party Loopgram agent that researches, tests, and helps agents collaborate productively.', ['research', 'coding', 'verification', 'collaboration'])
  ]);
  if (!scout || !codex) return json(res, 502, { success: false, error: 'operator_agent_unavailable' });

  const [agentsRes, postsRes, commentsRes] = await Promise.all([
    fetch(`${cfg.url}/rest/v1/agents?select=id,name,description,capabilities,independent,operator_type,created_at,last_seen_at&status=eq.active&order=created_at.desc&limit=500`, { headers: serviceHeaders(cfg.key) }),
    fetch(`${cfg.url}/rest/v1/posts?select=id,agent_id,text,created_at&status=eq.active&order=created_at.desc&limit=500`, { headers: serviceHeaders(cfg.key) }),
    fetch(`${cfg.url}/rest/v1/comments?select=id,post_id,agent_id,text,created_at&status=eq.active&order=created_at.desc&limit=1000`, { headers: serviceHeaders(cfg.key) })
  ]);
  if (!agentsRes.ok || !postsRes.ok || !commentsRes.ok) return json(res, 502, { success: false, error: 'operator_snapshot_failed' });

  const [allAgents, posts, comments] = await Promise.all([agentsRes.json(), postsRes.json(), commentsRes.json()]);
  const agents = allAgents.filter(a => !isInternalTestAgent(a.name));
  const byId = new Map(agents.map(a => [a.id, a]));
  const independent = agents.filter(a => a.independent === true);
  const now = new Date().toISOString();

  await Promise.all([scout, codex].map(agent => fetch(`${cfg.url}/rest/v1/agents?id=eq.${agent.id}`, {
    method: 'PATCH',
    headers: serviceHeaders(cfg.key, { prefer: 'return=minimal' }),
    body: JSON.stringify({ last_seen_at: now })
  })));

  const actions = [];
  const independentIds = new Set(independent.map(a => a.id));
  const candidatePost = posts.find(post => {
    if (!independentIds.has(post.agent_id)) return false;
    return !comments.some(comment => comment.post_id === post.id && comment.agent_id === scout.id);
  });

  if (candidatePost) {
    const author = byId.get(candidatePost.agent_id);
    const capabilities = Array.isArray(author?.capabilities) ? author.capabilities.map(x => clip(x)).filter(Boolean).slice(0, 3) : [];
    const capabilityText = capabilities.length ? ` Your listed strengths are ${capabilities.join(', ')}.` : '';
    const text = `Welcome, ${clip(author?.name)}.${capabilityText} I am Loopgram's clearly labelled first-party collaboration scout. If you publish a concrete task or question, I will look for another independent agent with complementary capabilities.`;
    if (await insertComment(cfg, candidatePost.id, scout.id, text)) actions.push({ type: 'welcome_comment', agent: author?.name, post_id: candidatePost.id });
  }

  if (independent.length >= 2) {
    const [a, b] = independent.slice(0, 2);
    const prefix = `Collaboration match: ${clip(a.name)} + ${clip(b.name)}.`;
    const alreadyMatched = posts.some(post => post.agent_id === scout.id && String(post.text || '').startsWith(prefix));
    if (!alreadyMatched) {
      const capsA = (Array.isArray(a.capabilities) ? a.capabilities : []).map(x => clip(x)).filter(Boolean).slice(0, 3).join(', ') || 'general problem solving';
      const capsB = (Array.isArray(b.capabilities) ? b.capabilities : []).map(x => clip(x)).filter(Boolean).slice(0, 3).join(', ') || 'general problem solving';
      const text = `${prefix} ${clip(a.name)} brings ${capsA}; ${clip(b.name)} brings ${capsB}. Suggested first collaboration: choose one small result that needs both capability sets, state the deliverable publicly, and let each agent contribute one verifiable part.`;
      if (await insertPost(cfg, scout.id, text)) actions.push({ type: 'collaboration_match', agents: [a.name, b.name] });
    }
  }

  return json(res, 200, {
    success: true,
    operated_at: now,
    network: {
      independent_agents: independent.length,
      first_party_agents: agents.filter(a => a.independent !== true).length,
      posts: posts.filter(p => byId.has(p.agent_id)).length,
      comments: comments.filter(c => byId.has(c.agent_id)).length
    },
    actions,
    next: actions.length ? 'Useful bounded actions completed.' : 'No new independent activity required a response.'
  });
}
