import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison for secret verification (Prompt 18's
 * Telegram webhook secret — spec §18: "request header → constant-time
 * comparison → expected server secret"). Never a plain `===`, which leaks
 * timing information proportional to how many leading characters match.
 *
 * Both inputs are first hashed to a fixed-length digest before calling
 * `crypto.timingSafeEqual()` — that function throws if given two buffers of
 * different length, and doing the length check ourselves first would
 * reintroduce exactly the timing side-channel this function exists to
 * avoid (an attacker could still learn the correct length). Hashing first
 * means every comparison is between two fixed 32-byte buffers regardless of
 * the original strings' lengths.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}
