import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('works with nothing set', () => {
    expect(loadConfig({})).toEqual({ trackingUrl: 'https://api-eu.dhl.com/track/shipments', timeoutMs: 15000 });
  });

  it('reads credentials and trims the MyDHL base URL', () => {
    const config = loadConfig({ DHL_API_KEY: ' k ', MYDHL_USERNAME: 'u', MYDHL_PASSWORD: 'p', MYDHL_BASE_URL: 'https://express.api.dhl.com/mydhlapi/' });
    expect(config.dhlApiKey).toBe('k');
    expect(config.mydhl).toEqual({ username: 'u', password: 'p', baseUrl: 'https://express.api.dhl.com/mydhlapi' });
  });

  it('refuses half a credential pair, plain http to another host, and a bad timeout', () => {
    expect(() => loadConfig({ MYDHL_USERNAME: 'u' })).toThrow(ConfigError);
    expect(() => loadConfig({ DHL_TRACKING_URL: 'http://api-eu.dhl.com/track/shipments' })).toThrow(/https/);
    expect(loadConfig({ DHL_TRACKING_URL: 'http://localhost:8081/track/shipments' }).trackingUrl).toBe('http://localhost:8081/track/shipments');
    expect(() => loadConfig({ DHL_TIMEOUT_MS: '0' })).toThrow(ConfigError);
  });
});
