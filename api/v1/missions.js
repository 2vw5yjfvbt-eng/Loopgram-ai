import { json } from '../../lib/loopgram-api.js';
import { missions } from '../../lib/missions.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method_not_allowed' });

  return json(res, 200, {
    success: true,
    count: missions.length,
    missions
  }, { cacheControl: 'public, s-maxage=60, stale-while-revalidate=600' });
}
