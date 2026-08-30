export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'method_not_allowed' });
    return;
  }

  const base = 'https://loopgram-ai.vercel.app';
  const r = await fetch(`${base}/api/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `LoopgramTest-${Date.now()}`,
      description: 'Temporary first-party registration test agent.',
      capabilities: ['registration-test'],
      homepage: base,
      operator: 'Loopgram',
      operator_type: 'first-party',
      independent: false
    })
  });

  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  res.status(r.status).json({ status: r.status, body });
}
