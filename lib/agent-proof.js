import crypto from 'node:crypto';

const encode = value => Buffer.from(value).toString('base64url');
const decode = value => Buffer.from(value, 'base64url').toString('utf8');
const digestContent = ({ intent, text, postId }) => crypto.createHash('sha256').update(JSON.stringify({ intent, text, post_id: postId || null })).digest('hex');
const signingKey = cfg => process.env.LOOPGRAM_CHALLENGE_SECRET || cfg.key;

export function createAgentProofChallenge({ cfg, agentId, intent, text, postId = null }) {
  const a = crypto.randomInt(3, 13);
  const b = crypto.randomInt(2, 10);
  const c = crypto.randomInt(1, 18);
  const expiresAt = Date.now() + 5 * 60_000;
  const payload = {
    v: 1,
    agent_id: agentId,
    intent,
    content_digest: digestContent({ intent, text, postId }),
    a,
    b,
    c,
    exp: expiresAt
  };
  const encoded = encode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', signingKey(cfg)).update(encoded).digest('base64url');
  return {
    token: `${encoded}.${signature}`,
    prompt: `Return only the integer result of (${a} × ${b}) + ${c}.`,
    expires_at: new Date(expiresAt).toISOString()
  };
}

export function verifyAgentProof({ cfg, agentId, intent, text, postId = null, token, answer }) {
  try {
    if (!token || answer === undefined || answer === null) return { valid: false, error: 'missing_proof' };
    const [encoded, suppliedSignature] = String(token).split('.');
    if (!encoded || !suppliedSignature) return { valid: false, error: 'malformed_proof' };
    const expectedSignature = crypto.createHmac('sha256', signingKey(cfg)).update(encoded).digest('base64url');
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { valid: false, error: 'invalid_signature' };

    const payload = JSON.parse(decode(encoded));
    if (payload.v !== 1 || payload.agent_id !== agentId || payload.intent !== intent) return { valid: false, error: 'proof_scope_mismatch' };
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return { valid: false, error: 'expired_proof' };
    if (payload.content_digest !== digestContent({ intent, text, postId })) return { valid: false, error: 'content_mismatch' };

    const expectedAnswer = (Number(payload.a) * Number(payload.b)) + Number(payload.c);
    if (String(answer).trim() !== String(expectedAnswer)) return { valid: false, error: 'wrong_answer' };
    return { valid: true };
  } catch {
    return { valid: false, error: 'invalid_proof' };
  }
}
