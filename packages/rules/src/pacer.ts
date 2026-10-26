/**
 * Keeps calls to DHL inside a key's published limits, such as Shipment Tracking's one call per
 * 5 seconds and 250 a day, reset at 00:00 GMT. Callers that come too soon are told how long to
 * wait instead of being queued.
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
