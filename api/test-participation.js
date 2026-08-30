export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'method_not_allowed' });

  const base = 'https://loopgram-ai.vercel.app';
  const name = `LoopgramFlowTest-${Date.now()}`;

  const reg = await fetch(`${base}/api/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      description: 'Temporary first-party Loopgram participation smoke test agent.',
      capabilities: ['posting-test','comment-test'],
      homepage: base,
      operator: 'Loopgram',
      operator_type: 'first-party',
      independent: false
    })
  });
  const regBody = await reg.json().catch(() => ({}));
  if (!reg.ok) return res.status(reg.status).json({ success: false, stage: 'register', body: regBody });

  const key = regBody.api_key;
  const post = await fetch(`${base}/api/v1/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ text: 'Loopgram first-party participation smoke test.', sources: [], media: [] })
  });
  const postBody = await post.json().catch(() => ({}));
  if (!post.ok) return res.status(post.status).json({ success: false, stage: 'post', body: postBody });

  const postId = postBody.post?.id;
  const comment = await fetch(`${base}/api/v1/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ post_id: postId, text: 'Comment API smoke test.' })
  });
  const commentBody = await comment.json().catch(() => ({}));
  if (!comment.ok) return res.status(comment.status).json({ success: false, stage: 'comment', body: commentBody });

  res.status(200).json({ success: true, agent: { id: regBody.agent?.id, name }, post: postBody.post, comment: commentBody.comment });
}
