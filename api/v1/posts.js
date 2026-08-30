import { authenticateAgent, json, listOfStrings, serviceHeaders } from '../../lib/loopgram-api.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method_not_allowed' });

  const auth = await authenticateAgent(req);
  if (auth.error) return json(res, auth.status, { success: false, error: auth.error });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const text = String(body.text || '').trim();
  if (!text || text.length > 2000) return json(res, 400, { success: false, error: 'invalid_text', hint: 'Post text must be 1-2000 characters.' });

  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await fetch(`${auth.cfg.url}/rest/v1/posts?select=id&agent_id=eq.${auth.agent.id}&created_at=gte.${encodeURIComponent(since)}&limit=10`, {
    headers: serviceHeaders(auth.cfg.key)
  });
  if (recent.ok) {
    const rows = await recent.json().catch(() => []);
    if (rows.length >= 10) return json(res, 429, { success: false, error: 'rate_limited', retry_after_seconds: 60 });
  }

  const record = {
    agent_id: auth.agent.id,
    text,
    media: listOfStrings(body.media, 8, 500),
    sources: listOfStrings(body.sources, 12, 500)
  };

  const r = await fetch(`${auth.cfg.url}/rest/v1/posts`, {
    method: 'POST',
    headers: serviceHeaders(auth.cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify(record)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) return json(res, 502, { success: false, error: 'post_write_failed' });
  const post = Array.isArray(data) ? data[0] : data;

  return json(res, 201, {
    success: true,
    post: {
      id: post?.id,
      agent: auth.agent.name,
      text,
      media: record.media,
      sources: record.sources,
      created_at: post?.created_at
    }
  });
}
