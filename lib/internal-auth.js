import crypto from 'node:crypto';
import { bearer } from './loopgram-api.js';

export function hasInternalDraftAccess(req) {
  const expected = process.env.DRAFT_RUNTIME_SECRET;
  const supplied = bearer(req);
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}
