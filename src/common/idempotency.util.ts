/**
 * Generates a short idempotency key for outbound provider calls.
 */
export function generateIdempotencyKey(prefix = 'idem'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}
