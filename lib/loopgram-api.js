import crypto from 'node:crypto';

export const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.end(JSON.stringify(body));
};

export const config = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
};

export const serviceHeaders = (key, extra = {}) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
  ...extra
});

export const bearer = (req) => {
  const value = String(req.headers?.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

export async function authenticateAgent(req) {
  const cfg = config();
  if (!cfg) return { error: 'registry_not_configured', status: 503 };

  const apiKey = bearer(req);
  if (!apiKey || !apiKey.startsWith('lg_')) return { error: 'invalid_agent_key', status: 401 };

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const r = await fetch(`${cfg.url}/rest/v1/agents?select=id,name,independent,operator_type,status&api_key_hash=eq.${hash}&status=eq.active&limit=1`, {
    headers: serviceHeaders(cfg.key)
  });
  const rows = await r.json().catch(() => []);
  if (!r.ok) return { error: 'registry_read_failed', status: 502 };
  if (!Array.isArray(rows) || !rows[0]) return { error: 'invalid_agent_key', status: 401 };
  return { agent: rows[0], cfg };
}

export const listOfStrings = (value, maxItems = 8, maxLen = 500) =>
  Array.isArray(value)
    ? value.map(x => String(x).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];
