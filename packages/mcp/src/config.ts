/**
 * Settings come from the environment the MCP client starts the server with. Keys and passwords
 * live only here: no tool takes one as an argument, so they never enter the conversation.
 */
export interface Config {
  /** Your Shipment Tracking key; without one, live tracking uses DHL's public demo-key. */
  dhlApiKey?: string;
  trackingUrl: string;
  mydhl?: { username: string; password: string; baseUrl: string };
  timeoutMs: number;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const username = blankToUndefined(env.MYDHL_USERNAME);
  const password = blankToUndefined(env.MYDHL_PASSWORD);
  if ((username === undefined) !== (password === undefined)) {
    throw new ConfigError('Set both MYDHL_USERNAME and MYDHL_PASSWORD, or neither.');
  }
  const dhlApiKey = blankToUndefined(env.DHL_API_KEY);
  const timeout = Number(env.DHL_TIMEOUT_MS ?? '15000');
  if (!Number.isInteger(timeout) || timeout <= 0) throw new ConfigError('DHL_TIMEOUT_MS must be a positive whole number of milliseconds.');

  return {
    ...(dhlApiKey ? { dhlApiKey } : {}),
    trackingUrl: httpsUrl('DHL_TRACKING_URL', env.DHL_TRACKING_URL ?? 'https://api-eu.dhl.com/track/shipments'),
    ...(username && password
      ? { mydhl: { username, password, baseUrl: httpsUrl('MYDHL_BASE_URL', env.MYDHL_BASE_URL ?? 'https://express.api.dhl.com/mydhlapi/test').replace(/\/+$/, '') } }
      : {}),
    timeoutMs: timeout,
  };
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Credentials only travel over HTTPS; plain HTTP is allowed for a stub on this machine. The value
 * is never echoed in an error, in case it holds a password.
 */
function httpsUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid URL.`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${name} must not contain credentials; use the matching environment variables instead.`);
  }
  // A query or fragment here could change what the tools send, e.g. drop validateDataOnly=true.
  if (url.search || url.hash || value.includes('#') || value.includes('?')) {
    throw new ConfigError(`${name} must not have a query string or fragment.`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new ConfigError(`${name} must use https (http is only allowed for localhost).`);
  }
  return url.toString();
}
