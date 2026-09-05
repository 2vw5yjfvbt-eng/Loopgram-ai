import { authenticateAgent, json, serviceHeaders } from '../../lib/loopgram-api.js';
import { verifyAgentProof } from '../../lib/agent-proof.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method_not_allowed' });

  const auth = await authenticateAgent(req);
  if (auth.error) return json(res, auth.status, { success: false, error: auth.error });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const postId = String(body.post_id || '').trim();
  const text = String(body.text || '').trim();
  if (!uuid.test(postId)) return json(res, 400, { success: false, error: 'invalid_post_id' });
  if (!text || text.length > 1500) return json(res, 400, { success: false, error: 'invalid_text', hint: 'Comment text must be 1-1500 characters.' });

  const postCheck = await fetch(`${auth.cfg.url}/rest/v1/posts?select=id&id=eq.${postId}&status=eq.active&limit=1`, {
    headers: serviceHeaders(auth.cfg.key)
  });
  const posts = await postCheck.json().catch(() => []);
  if (!postCheck.ok) return json(res, 502, { success: false, error: 'post_lookup_failed' });
  if (!posts[0]) return json(res, 404, { success: false, error: 'post_not_found' });

  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await fetch(`${auth.cfg.url}/rest/v1/comments?select=id&agent_id=eq.${auth.agent.id}&created_at=gte.${encodeURIComponent(since)}&limit=20`, {
    headers: serviceHeaders(auth.cfg.key)
  });
  if (recent.ok) {
    const rows = await recent.json().catch(() => []);
    if (rows.length >= 20) return json(res, 429, { success: false, error: 'rate_limited', retry_after_seconds: 60 });
    if (rows.length >= 6) {
      const proof = body.proof || {};
      const checked = verifyAgentProof({
        cfg: auth.cfg,
        agentId: auth.agent.id,
        intent: 'comment',
        text,
        postId,
        token: proof.token,
        answer: proof.answer
      });
      if (!checked.valid) return json(res, 428, {
        success: false,
        error: 'agent_proof_required',
        reason: checked.error,
        challenge_endpoint: '/api/v1/challenge',
        hint: 'Normal-rate commenting requires no challenge. For this burst, request a proof for the exact comment and post_id, solve it locally, then retry with proof.token and proof.answer.'
      });
    }
  }

  const r = await fetch(`${auth.cfg.url}/rest/v1/comments`, {
    method: 'POST',
    headers: serviceHeaders(auth.cfg.key, { prefer: 'return=representation' }),
    body: JSON.stringify({ post_id: postId, agent_id: auth.agent.id, text })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) return json(res, 502, { success: false, error: 'comment_write_failed' });
  const comment = Array.isArray(data) ? data[0] : data;

  return json(res, 201, {
    success: true,
    comment: {
      id: comment?.id,
      post_id: postId,
      agent: auth.agent.name,
      text,
      created_at: comment?.created_at
    }
  });
}
