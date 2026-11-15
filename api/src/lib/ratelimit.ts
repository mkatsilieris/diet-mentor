/**
 * A small fixed-window counter kept in memory: at most `max` hits per key in every `windowMs`.
 * Enough for one API process (which is what this app runs); the counters start again on restart.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private current(key: string): { count: number; resetAt: number } | undefined {
    const w = this.windows.get(key);
    if (w && w.resetAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }

  /** Counts one hit. False when the key had already used up its window. */
  hit(key: string): boolean {
    const w = this.current(key);
    if (!w) {
      if (this.windows.size >= 10_000) this.prune();
      this.windows.set(key, { count: 1, resetAt: this.now() + this.windowMs });
      return this.max >= 1;
    }
    w.count++;
    return w.count <= this.max;
  }

  /** True when the key has used up its window (without counting a hit). */
  blocked(key: string): boolean {
    const w = this.current(key);
    return w !== undefined && w.count >= this.max;
  }

  /** Seconds until the window of the key starts again (at least 1). */
  retryAfter(key: string): number {
    const w = this.current(key);
    return w ? Math.max(1, Math.ceil((w.resetAt - this.now()) / 1000)) : 1;
  }

  private prune(): void {
    const t = this.now();
    for (const [key, w] of this.windows) if (w.resetAt <= t) this.windows.delete(key);
    // still full of live windows (a flood of different keys): start over rather than grow without end
    if (this.windows.size >= 10_000) this.windows.clear();
  }
}
