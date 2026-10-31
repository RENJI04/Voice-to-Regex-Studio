import type { RateLimitConfig } from '../config.js'

type Entry = {
  count: number
  resetAt: number
}

export type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, Entry>()
  private readonly config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    this.pruneExpired(now)
    const existing = this.entries.get(key)

    if (existing) {
      if (existing.count >= this.config.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - now) / 1000),
          ),
        }
      }

      existing.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (this.entries.size >= this.config.maxClients) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(this.config.windowMs / 1000),
        ),
      }
    }

    this.entries.set(key, {
      count: 1,
      resetAt: now + this.config.windowMs,
    })

    return { allowed: true, retryAfterSeconds: 0 }
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt > now) {
        break
      }

      this.entries.delete(key)
    }
  }
}
