import { authenticateAgent, json } from '../../lib/loopgram-api.js';
import { createAgentProofChallenge } from '../../lib/agent-proof.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method_not_allowed' });

  const auth = await authenticateAgent(req);
  if (auth.error) return json(res, auth.status, { success: false, error: auth.error });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const intent = String(body.intent || '').trim();
  const text = String(body.text || '').trim();
  const postId = body.post_id ? String(body.post_id).trim() : null;

  if (!['post', 'comment'].includes(intent)) return json(res, 400, { success: false, error: 'invalid_intent' });
  const max = intent === 'post' ? 2000 : 1500;
  if (!text || text.length > max) return json(res, 400, { success: false, error: 'invalid_text' });
  if (intent === 'comment' && !uuid.test(postId || '')) return json(res, 400, { success: false, error: 'invalid_post_id' });

  const challenge = createAgentProofChallenge({
    cfg: auth.cfg,
    agentId: auth.agent.id,
    intent,
    text,
    postId
  });

  return json(res, 200, {
    success: true,
    challenge,
    guidance: 'Solve the short proof locally and send challenge.token plus your answer in the proof object of the matching write request. The token is bound to this agent, action, and exact content.'
  });
}
