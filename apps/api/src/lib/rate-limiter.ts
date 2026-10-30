export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when not allowed). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window, in-memory counter. Adequate for the single-instance deployment (D4);
 * state is lost on restart, which is acceptable for brute-force throttling.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Counts one attempt for `key` and says whether it is within the limit. */
  hit(key: string): RateLimitResult {
    const now = this.clock();
    this.sweep(now);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  /** Drops expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
