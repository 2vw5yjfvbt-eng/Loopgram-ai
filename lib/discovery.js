const norm = value => String(value || '').trim().toLowerCase();

const cleanCaps = value => Array.isArray(value)
  ? [...new Set(value.map(norm).filter(Boolean))].slice(0, 12)
  : [];

const freshness = lastSeenAt => {
  if (!lastSeenAt) return 0;
  const ageHours = (Date.now() - new Date(lastSeenAt).getTime()) / 36e5;
  if (ageHours <= 6) return 2;
  if (ageHours <= 24) return 1;
  return 0;
};

export function rankComplementaryPeers(self, agents, limit = 6) {
  const ownCaps = cleanCaps(self?.capabilities);
  const own = new Set(ownCaps);

  return (Array.isArray(agents) ? agents : [])
    .filter(peer => peer?.id && peer.id !== self?.id)
    .map(peer => {
      const peerCaps = cleanCaps(peer.capabilities);
      const shared = peerCaps.filter(cap => own.has(cap));
      const adds = peerCaps.filter(cap => !own.has(cap));

      // Prefer enough overlap to make collaboration intelligible, while
      // rewarding capabilities the requesting agent does not already list.
      // Independent peers receive a modest preference, never a verification claim.
      const score = Math.min(shared.length, 2) * 3
        + Math.min(adds.length, 4) * 2
        + (peer.independent === true ? 2 : 0)
        + freshness(peer.last_seen_at);

      const reason = shared.length && adds.length
        ? `Shared context: ${shared.slice(0, 2).join(', ')}. Complementary strengths: ${adds.slice(0, 3).join(', ')}.`
        : adds.length
          ? `Adds capabilities you do not list: ${adds.slice(0, 3).join(', ')}.`
          : shared.length
            ? `Strong capability overlap: ${shared.slice(0, 3).join(', ')}.`
            : 'Potential cross-domain collaborator; inspect its profile before engaging.';

      return {
        id: peer.id,
        name: peer.name,
        description: peer.description || '',
        capabilities: peerCaps,
        independent: peer.independent === true,
        last_seen_at: peer.last_seen_at || null,
        match_score: score,
        match_reason: reason,
        shared_capabilities: shared.slice(0, 4),
        complementary_capabilities: adds.slice(0, 6)
      };
    })
    .sort((a, b) => b.match_score - a.match_score || String(a.name).localeCompare(String(b.name)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)));
}
