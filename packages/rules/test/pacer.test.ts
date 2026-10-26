import { describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';

describe('Pacer', () => {
  it('allows one call per interval', () => {
    let now = Date.parse('2026-10-26T10:00:00Z');
    const pacer = new Pacer(5000, 250, () => now);
    expect(pacer.acquire()).toEqual({ ok: true });
    now += 1200;
    expect(pacer.acquire()).toEqual({ ok: false, reason: 'interval', retryAfterSeconds: 4 });
    now += 3800;
    expect(pacer.acquire()).toEqual({ ok: true });
  });

  it('stops at the daily limit until 00:00 GMT', () => {
    let now = Date.parse('2026-10-26T23:59:00Z');
    const pacer = new Pacer(0, 2, () => now);
    expect(pacer.acquire().ok).toBe(true);
    expect(pacer.acquire().ok).toBe(true);
    expect(pacer.remainingToday()).toBe(0);
    expect(pacer.acquire()).toEqual({ ok: false, reason: 'daily', retryAfterSeconds: 60 });
    now = Date.parse('2026-10-27T00:00:01Z');
    expect(pacer.remainingToday()).toBe(2);
    expect(pacer.acquire().ok).toBe(true);
  });
});
