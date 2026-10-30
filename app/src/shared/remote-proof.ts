import { createHmac } from 'node:crypto';

/** One side's proof that it holds the host's token, bound to both sides' nonces (DSP-111). */
export function proofOf(token: string, role: 'host' | 'client', ...nonces: readonly string[]): string {
  return createHmac('sha256', token).update([role, ...nonces].join('|')).digest('hex');
}
