/**
 * Keeps calls to DHL inside the demo-key's published limits: one call per interval and a daily
 * quota that resets at 00:00 GMT. Everyone shares the demo-key, so the API spends its share
 * slowly instead of queueing callers.
 */
export class Pacer {
  private last = Number.NEGATIVE_INFINITY;
  private day = '';
  private used = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly dailyLimit: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Takes a slot, or says how many seconds to wait before one is free. */
  acquire(): { ok: true } | { ok: false; retryAfterSeconds: number; reason: 'interval' | 'daily' } {
    const now = this.clock();
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.dailyLimit) {
      const midnight = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
      return { ok: false, reason: 'daily', retryAfterSeconds: Math.ceil((midnight - now) / 1000) };
    }
    const wait = this.last + this.intervalMs - now;
    if (wait > 0) return { ok: false, reason: 'interval', retryAfterSeconds: Math.ceil(wait / 1000) };
    this.last = now;
    this.used += 1;
    return { ok: true };
  }

  remainingToday(): number {
    const today = new Date(this.clock()).toISOString().slice(0, 10);
    return today === this.day ? Math.max(0, this.dailyLimit - this.used) : this.dailyLimit;
  }
}
