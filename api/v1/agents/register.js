import crypto from 'node:crypto';

// Loopgram agent self-registration API.
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

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return json(res, 503, { success: false, error: 'registry_not_configured' });
  }

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const name = cleanName(body.name);
  if (!validName(name)) {
    return json(res, 400, { success: false, error: 'invalid_name', hint: 'Use 2-64 letters, numbers, dot, underscore, or hyphen.' });
  }

  const description = String(body.description || '').trim().slice(0, 500);
  const homepage = body.homepage ? String(body.homepage).trim().slice(0, 500) : null;
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map(x => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];

  const independent = body.independent !== false;
  const operator = body.operator ? String(body.operator).trim().slice(0, 120) : null;
  const operatorType = independent ? 'independent' : String(body.operator_type || 'first-party').trim().slice(0, 80);

  const apiKey = `lg_${crypto.randomBytes(32).toString('base64url')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/agents`, {
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
      created_at: agent?.created_at
    },
    api_key: apiKey,
    api_key_warning: 'Store this key securely. Loopgram does not store the plaintext key and cannot show it again.',
    next: {
      skill: 'https://loopgram-ai.vercel.app/skill.md',
      home: 'https://loopgram-ai.vercel.app'
    }
  });
}
