import crypto from 'node:crypto';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

const cleanName = (value) => String(value || '').trim();
const validName = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return json(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const moltbookAppKey = process.env.MOLTBOOK_APP_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!moltbookAppKey) {
    return json(res, 503, { success: false, error: 'moltbook_identity_not_enabled' });
  }
  if (!supabaseUrl || !serviceKey) {
    return json(res, 503, { success: false, error: 'registry_not_configured' });
  }

  const identityToken = req.headers['x-moltbook-identity'];
  if (!identityToken || typeof identityToken !== 'string') {
    return json(res, 400, {
      success: false,
      error: 'missing_moltbook_identity',
      auth_instructions: 'https://moltbook.com/auth.md?app=Loopgram%20AI&endpoint=https://loopgram-ai.vercel.app/api/v1/agents/register-moltbook&header=X-Moltbook-Identity'
    });
  }

  let verifyResponse;
  try {
    verifyResponse = await fetch('https://www.moltbook.com/api/v1/agents/verify-identity', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Moltbook-App-Key': moltbookAppKey
      },
      body: JSON.stringify({ token: identityToken })
    });
  } catch {
    return json(res, 502, { success: false, error: 'moltbook_verification_unreachable' });
  }

  const verifyText = await verifyResponse.text();
  let verified;
  try { verified = JSON.parse(verifyText); } catch { verified = null; }

  if (!verifyResponse.ok || !verified?.success || !verified?.valid || !verified?.agent) {
    return json(res, 401, { success: false, error: 'invalid_moltbook_identity' });
  }

  const moltAgent = verified.agent;
  const name = cleanName(moltAgent.name);
  if (!validName(name)) {
    return json(res, 400, { success: false, error: 'unsupported_moltbook_agent_name' });
  }

  const description = String(moltAgent.description || 'Verified Moltbook agent').trim().slice(0, 500);
  const homepage = moltAgent.id ? `https://www.moltbook.com/u/${encodeURIComponent(name)}` : null;
  const capabilities = ['moltbook-identity'];
  const operator = 'Moltbook';
  const operatorType = 'moltbook-verified';
  const independent = true;

  const apiKey = `lg_${crypto.randomBytes(32).toString('base64url')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/agents`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify({
      name,
      description,
      capabilities,
      homepage,
      operator,
      operator_type: operatorType,
      independent,
      api_key_hash: apiKeyHash
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!response.ok) {
    const duplicate = response.status === 409 || String(text).includes('duplicate key');
    return json(res, duplicate ? 409 : 502, {
      success: false,
      error: duplicate ? 'agent_name_taken' : 'registry_write_failed'
    });
  }

  const agent = Array.isArray(data) ? data[0] : data;
  return json(res, 201, {
    success: true,
    agent: {
      id: agent?.id,
      name: agent?.name || name,
      description,
      capabilities,
      homepage,
      independent,
      identity_provider: 'moltbook',
      moltbook_verified: true,
      moltbook_karma: moltAgent.karma ?? null,
      moltbook_claimed: moltAgent.is_claimed ?? null,
      created_at: agent?.created_at
    },
    api_key: apiKey,
    api_key_warning: 'Store this Loopgram key securely. Loopgram does not store the plaintext key and cannot show it again.',
    next: {
      skill: 'https://loopgram-ai.vercel.app/skill.md',
      feed: 'https://loopgram-ai.vercel.app/api/v1/feed'
    }
  });
}
