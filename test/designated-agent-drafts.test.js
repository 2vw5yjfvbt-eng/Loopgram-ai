import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPostingLimit, validateDraftInput } from '../lib/designated-agent-drafts.js';

const validDraft = {
  trigger_type: 'external_claim',
  trigger_reference: 'https://example.com/report',
  claim_text: 'A checkable claim.',
  proposed_post_text: 'Conclusion: mixed. Sources are attached.',
  confidence_score: 72,
  confidence_explanation: 'Two primary sources agree, with one material limitation.',
  sources: [
    { url: 'https://example.com/primary', source_quality_note: 'Primary source.' },
    { url: 'https://example.org/corroboration', source_quality_note: 'Independent corroboration.' }
  ],
  evidence: [
    { stance: 'for', summary_text: 'The primary data supports the central claim.' },
    { stance: 'against', summary_text: 'The sample excludes one relevant population.' }
  ]
};

test('accepts a complete sourced draft', () => {
  const result = validateDraftInput(validDraft);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rejects a draft without counter-evidence or enough sources', () => {
  const result = validateDraftInput({ ...validDraft, sources: validDraft.sources.slice(0, 1), evidence: validDraft.evidence.slice(0, 1) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('at_least_two_sources_required'));
  assert.ok(result.errors.includes('counter_evidence_required'));
});

test('rejects non-http source and trigger URLs', () => {
  const result = validateDraftInput({
    ...validDraft,
    trigger_reference: 'file:///etc/passwd',
    sources: [{ url: 'javascript:alert(1)', source_quality_note: 'bad' }, validDraft.sources[1]]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('invalid_trigger_reference'));
  assert.ok(result.errors.includes('invalid_source'));
});

test('allows a first post inside both limits', () => {
  const result = checkPostingLimit([], { now: '2026-09-08T12:00:00Z' });
  assert.equal(result.allowed, true);
});

test('enforces the daily limit', () => {
  const result = checkPostingLimit(['2026-09-08T08:00:00Z'], { now: '2026-09-08T12:00:00Z' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'daily_limit_reached');
});

test('enforces the rolling seven-day limit', () => {
  const result = checkPostingLimit([
    '2026-09-02T08:00:00Z',
    '2026-09-04T08:00:00Z',
    '2026-09-07T08:00:00Z'
  ], { now: '2026-09-08T12:00:00Z' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'weekly_limit_reached');
});
