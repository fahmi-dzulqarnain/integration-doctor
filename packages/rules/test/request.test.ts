import { describe, expect, it } from 'vitest';
import { diagnose, type Finding } from '../src/index.js';
import { NOW, TRACKING_URL, trackingRequest } from './fixtures.js';

const ids = (findings: Finding[]) => findings.map((f) => f.ruleId);
const run = (...args: Parameters<typeof diagnose>) => diagnose(args[0], { now: NOW, ...args[1] });

describe('a correct Shipment Tracking request', () => {
  it('has no findings', () => {
    expect(run(trackingRequest()).findings).toEqual([]);
  });

  it('reads header names case-insensitively, as DHL does since 27-04-2026', () => {
    expect(run(trackingRequest({ headers: { 'dhl-api-key': 'k3yForTestsOnly' } })).findings).toEqual([]);
    expect(run(trackingRequest({ headers: [['DHL-Api-Key', 'k3yForTestsOnly']] })).findings).toEqual([]);
  });
});

describe('URL and environment', () => {
  it('rejects a URL it cannot parse', () => {
    expect(ids(run(trackingRequest({ url: 'api-eu.dhl.com/track/shipments' })).findings)).toContain('url.invalid');
  });

  it('flags plain http', () => {
    expect(ids(run(trackingRequest({ url: TRACKING_URL.replace('https', 'http') })).findings)).toContain('url.not-https');
  });

  it('points the retired wsbexpress endpoint at MyDHL API', () => {
    const { findings } = run({ method: 'POST', url: 'https://wsbexpress.dhl.com/rest/sndpt/ShipmentRequest', body: '{}' });
    const legacy = findings.find((f) => f.ruleId === 'host.legacy-express');
    expect(legacy?.fix).toContain('express.api.dhl.com/mydhlapi');
  });

  it('flags a DHL host or path it does not know', () => {
    expect(ids(run(trackingRequest({ url: 'https://api-eu.dhl.com/tracking/shipments?trackingNumber=1' })).findings)).toContain('host.unknown-dhl');
  });

  it('stays quiet about hosts that are not DHL', () => {
    expect(run({ method: 'GET', url: 'https://example.com/anything' }).findings).toEqual([]);
  });

  it('warns about a key in the query string, for each such parameter', () => {
    const findings = run(trackingRequest({ url: `${TRACKING_URL}&apikey=abc&token=def` })).findings;
    expect(findings.filter((f) => f.ruleId === 'url.secret-in-query')).toHaveLength(2);
  });
});

describe('Tracking authentication', () => {
  it('requires the DHL-API-Key header', () => {
    const finding = run(trackingRequest({ headers: {} })).findings[0];
    expect(finding?.ruleId).toBe('auth.missing-api-key');
    expect(finding?.severity).toBe('error');
  });

  it('explains that an Authorization header is ignored', () => {
    const finding = run(trackingRequest({ headers: { Authorization: 'Bearer abc' } })).findings[0];
    expect(finding?.ruleId).toBe('auth.missing-api-key');
    expect(finding?.detail).toContain('ignores it');
  });

  it.each([' k3y', '"k3y"', 'Bearer k3y'])('rejects the decorated key %j', (key) => {
    expect(ids(run(trackingRequest({ headers: { 'DHL-API-Key': key } })).findings)).toEqual(['auth.malformed-api-key']);
  });

  it('notes that demo-key only returns mocked data', () => {
    const findings = run(trackingRequest({ headers: { 'DHL-API-Key': 'demo-key' } })).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'auth.demo-key', severity: 'info' });
  });

  it('applies the same header rule to Location Finder', () => {
    const { findings } = run({ method: 'GET', url: 'https://api.dhl.com/location-finder/v1/find-by-address?countryCode=MY' });
    expect(ids(findings)).toContain('auth.missing-api-key');
  });
});

describe('Tracking parameters', () => {
  it('requires trackingNumber and spots a misspelling', () => {
    const finding = run(trackingRequest({ url: 'https://api-eu.dhl.com/track/shipments?tracking_number=1' })).findings[0];
    expect(finding?.ruleId).toBe('tracking.missing-number');
    expect(finding?.detail).toContain('tracking_number');
  });

  it('flags spaces copied from a label', () => {
    const url = 'https://api-eu.dhl.com/track/shipments?trackingNumber=' + encodeURIComponent('0034 0434 2921');
    expect(ids(run(trackingRequest({ url })).findings)).toEqual(['tracking.number-whitespace']);
  });

  it('flags a repeated trackingNumber', () => {
    expect(ids(run(trackingRequest({ url: `${TRACKING_URL}&trackingNumber=2` })).findings)).toEqual(['tracking.repeated-number']);
  });

  it('flags an unknown service and accepts a known one', () => {
    expect(ids(run(trackingRequest({ url: `${TRACKING_URL}&service=Express` })).findings)).toEqual(['tracking.unknown-service']);
    expect(run(trackingRequest({ url: `${TRACKING_URL}&service=express` })).findings).toEqual([]);
  });

  it('flags a non-GET method and a path the specification does not have', () => {
    const post = run(trackingRequest({ method: 'POST' })).findings.find((f) => f.ruleId === 'endpoint.method');
    expect(post?.fix).toBe('Use GET.');
    const wrong = run(trackingRequest({ url: 'https://api-eu.dhl.com/track/shipment?trackingNumber=1' })).findings;
    expect(ids(wrong)).toContain('endpoint.unknown');
    expect(wrong.find((f) => f.ruleId === 'endpoint.unknown')?.fix).toContain('GET /shipments');
  });
});

describe('Parcel DE Shipping', () => {
  const orders = 'https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders';

  it('requires OAuth, or Basic plus a dhl-api-key', () => {
    expect(ids(run({ method: 'POST', url: orders, body: '{}', headers: { 'Content-Type': 'application/json' } }).findings)).toContain('auth.parcel-de-missing');
  });

  it('warns that Basic is being retired', () => {
    const headers = { Authorization: `Basic ${btoa('user:pass')}`, 'dhl-api-key': 'k', 'Content-Type': 'application/json' };
    expect(ids(run({ method: 'POST', url: orders, body: '{}', headers }).findings)).toContain('auth.parcel-de-basic');
  });

  it('suggests ?validate=true, and not when it is already there in any case', () => {
    const headers = { Authorization: 'Bearer token', 'Content-Type': 'application/json' };
    expect(ids(run({ method: 'POST', url: orders, body: '{}', headers }).findings)).toEqual(['parcel-de.validate']);
    expect(run({ method: 'POST', url: `${orders}?validate=true`, body: '{}', headers }).findings).toEqual([]);
    expect(run({ method: 'POST', url: `${orders}?validate=TRUE`, body: '{}', headers }).findings).toEqual([]);
  });

  it('needs no credentials for GET / and GET /labels, and allows the label download token', () => {
    const base = 'https://api-sandbox.dhl.com/parcel/de/shipping/v2';
    expect(run({ method: 'GET', url: `${base}/` }).findings).toEqual([]);
    expect(run({ method: 'GET', url: `${base}/labels?token=abc123` }).findings).toEqual([]);
  });
});

describe('odd input', () => {
  it('does not crash on non-string header values or a missing method', () => {
    expect(() => run({ method: undefined as unknown as string, url: TRACKING_URL, headers: { 'DHL-API-Key': 5 as unknown as string } })).not.toThrow();
    expect(run(trackingRequest({ headers: { 'DHL-API-Key': 5 as unknown as string } })).findings).toEqual([]);
  });

  it('does not run JSON checks on the retired XML endpoints', () => {
    const { findings } = run({ method: 'POST', url: 'https://xmlpi-ea.dhl.com/XMLShippingServlet', body: '<req:ShipmentRequest/>' });
    expect(ids(findings)).toEqual(['host.legacy-express']);
  });
});
