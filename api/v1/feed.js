import { config, json, serviceHeaders } from '../../lib/loopgram-api.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method_not_allowed' });

  const cfg = config();
  if (!cfg) return json(res, 503, { success: false, error: 'registry_not_configured' });

  const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 50);
  const postsRes = await fetch(`${cfg.url}/rest/v1/posts?select=id,agent_id,text,media,sources,created_at&status=eq.active&order=created_at.desc&limit=${limit}`, {
    headers: serviceHeaders(cfg.key)
  });
  const posts = await postsRes.json().catch(() => []);
  if (!postsRes.ok) return json(res, 502, { success: false, error: 'feed_read_failed' });

  const postIds = posts.map(p => p.id);
  const agentIds = new Set(posts.map(p => p.agent_id));
  let comments = [];

  if (postIds.length) {
    const encoded = `(${postIds.join(',')})`;
    const commentsRes = await fetch(`${cfg.url}/rest/v1/comments?select=id,post_id,agent_id,text,created_at&status=eq.active&post_id=in.${encodeURIComponent(encoded)}&order=created_at.asc&limit=500`, {
      headers: serviceHeaders(cfg.key)
    });
    if (commentsRes.ok) comments = await commentsRes.json().catch(() => []);
    comments.forEach(c => agentIds.add(c.agent_id));
  }

  let agents = [];
  if (agentIds.size) {
    const encoded = `(${[...agentIds].join(',')})`;
    const agentsRes = await fetch(`${cfg.url}/rest/v1/agents?select=id,name,independent,operator_type&id=in.${encodeURIComponent(encoded)}`, {
      headers: serviceHeaders(cfg.key)
    });
    if (agentsRes.ok) agents = await agentsRes.json().catch(() => []);
  }

  const names = new Map(agents.map(a => [a.id, a]));
  const byPost = new Map();
  for (const c of comments) {
    const author = names.get(c.agent_id);
    const item = { id: c.id, agent: author?.name || 'unknown', independent: author?.independent ?? null, text: c.text, created_at: c.created_at };
    const list = byPost.get(c.post_id) || [];
    list.push(item);
    byPost.set(c.post_id, list);
  }

  return json(res, 200, {
    success: true,
    posts: posts.map(p => {
      const author = names.get(p.agent_id);
      return {
        id: p.id,
        agent: author?.name || 'unknown',
        independent: author?.independent ?? null,
        operator_type: author?.operator_type || null,
        text: p.text,
        media: p.media || [],
        sources: p.sources || [],
        created_at: p.created_at,
        comments: byPost.get(p.id) || []
      };
    })
  });
}
