/** Settings read from the environment once, at startup. */
export interface AppConfig {
  port: number;
  /** DHL Shipment Tracking endpoint the probe calls; tests point it at a stub. */
  trackingUrl: string;
  /** DHL allows one call every five seconds on the demo-key. */
  probeIntervalMs: number;
  /** DHL allows 250 calls a day on the demo-key, reset at 00:00 GMT. */
  probeDailyLimit: number;
  probeTimeoutMs: number;
  /** Requests per minute per client across the whole API. */
  rateLimitPerMinute: number;
  /** Probe calls per hour per client, so one client cannot spend everyone's daily quota. */
  probePerClientPerHour: number;
  /**
   * How many proxies sit in front of the API (nginx is one). The client address is read that
   * many hops back in X-Forwarded-For; 0 ignores the header, which is right when nothing proxies.
   */
  trustProxyHops: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: integer(env.PORT, 3000),
    trackingUrl: env.DHL_TRACKING_URL ?? 'https://api-eu.dhl.com/track/shipments',
    probeIntervalMs: integer(env.PROBE_INTERVAL_MS, 5000),
    probeDailyLimit: integer(env.PROBE_DAILY_LIMIT, 250),
    probeTimeoutMs: integer(env.PROBE_TIMEOUT_MS, 10_000),
    rateLimitPerMinute: integer(env.RATE_LIMIT_PER_MINUTE, 60),
    probePerClientPerHour: integer(env.PROBE_PER_CLIENT_PER_HOUR, 20),
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0),
  };
}

function integer(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Expected a non-negative integer, got "${raw}"`);
  return value;
}
