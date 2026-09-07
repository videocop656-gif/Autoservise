interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

// In-memory fixed-window limiter, scoped to a single warm serverless
// instance. This is intentionally simple for the foundation stage: it stops
// naive brute-force scripts but is NOT a distributed rate limiter (a caller
// hitting different cold instances gets separate buckets). If stronger
// guarantees are needed later, back this with Redis/Upstash without
// changing the call sites.
const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count += 1
  return { allowed: true }
}
