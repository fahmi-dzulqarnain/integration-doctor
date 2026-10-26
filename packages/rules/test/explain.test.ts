import { describe, expect, it } from 'vitest';
import { CATALOGUE, explain } from '../src/index.js';
import { DHL_BODIES, NOW, shipmentRequest, trackingRequest } from './fixtures.js';

const top = (status: number, body: string, request?: Parameters<typeof explain>[0]['request']) =>
  explain({ status, body, ...(request && { request }) }, { now: NOW });

describe('Shipment Tracking errors', () => {
  it('tells a missing key apart from a key for another API', () => {
    expect(top(401, DHL_BODIES.trackingNoKey, trackingRequest()).matches[0]?.id).toBe('unified.401-not-allowed');
    expect(top(401, DHL_BODIES.trackingWrongProduct, trackingRequest()).matches[0]?.id).toBe('unified.401-not-for-resource');
  });

  it('adds the request findings that explain the 401', () => {
    const result = top(401, DHL_BODIES.trackingNoKey, trackingRequest({ headers: {} }));
    expect(result.requestFindings[0]?.ruleId).toBe('auth.missing-api-key');
  });

  it('explains 429 with the quota and the reset time', () => {
    const entry = top(429, DHL_BODIES.trackingQuota, trackingRequest()).matches[0];
    expect(entry?.id).toBe('unified.429');
    expect(entry?.fixes.join(' ')).toContain('24:00 GMT');
  });

  it('explains 404 only when the request shows it is Tracking', () => {
    expect(top(404, DHL_BODIES.trackingNotFound, trackingRequest()).matches[0]?.id).toBe('unified.404');
    expect(top(404, DHL_BODIES.trackingNotFound).matches).toEqual([]);
  });
});

describe('MyDHL errors', () => {
  it('recognises the MyDHL 401 body without a request', () => {
    const result = top(401, DHL_BODIES.mydhlBadCredentials);
    expect(result.detection.api).toBe('mydhl');
    expect(result.matches[0]?.id).toBe('mydhl.401');
    expect(result.message).toBe('Invalid Credentials');
  });

  it('reads the code from "998: …" and picks the date entry, not the other 998s', () => {
    const result = top(400, DHL_BODIES.mydhlDate);
    expect(result.code).toBe('998');
    expect(result.matches.map((m) => m.id)).toEqual(['mydhl.998-date']);
  });

  it('turns a schema error into the path of the missing field', () => {
    const result = top(400, DHL_BODIES.mydhlRequired);
    expect(result.path).toBe('customerDetails.shipperDetails.postalAddress.countryCode');
    expect(result.matches[0]?.id).toBe('mydhl.schema-required');
  });

  it('explains the validator\'s maxLength message, and the query-parameter one apart', () => {
    const body = top(400, DHL_BODIES.mydhlMaxLength);
    expect(body.matches[0]?.id).toBe('mydhl.schema-length');
    expect(body.path).toBe('customerDetails.shipperDetails.postalAddress.cityName');
    expect(top(400, DHL_BODIES.mydhlQueryFormat).matches[0]?.id).toBe('mydhl.format');
  });

  it('keeps every code when MyDHL reports several', () => {
    const result = top(400, DHL_BODIES.mydhlTwoCodes);
    expect(result.codes).toEqual(['7008', '998']);
    expect(result.matches.map((m) => m.id)).toEqual(expect.arrayContaining(['mydhl.7008', 'mydhl.998-date']));
  });

  it('matches the early-shipment-screening date message', () => {
    expect(top(400, '{"instance":"/expressapi/early-shipment-screening","detail":"#/plannedShippingDateAndTime is not well formatted"}').matches[0]?.id).toBe('mydhl.998-date');
  });

  it('does not take any "NNNNN:" message for MyDHL', () => {
    expect(top(400, '{"detail":"10115: Berlin is not a valid city"}').detection.api).toBe('unknown');
  });

  it.each([
    ['mydhl7121', '7121', 'mydhl.7121'],
    ['mydhl996', '996', 'mydhl.996'],
    ['mydhl8007', '8007', 'mydhl.8007'],
  ] as const)('maps %s to code %s', (body, code, id) => {
    const result = top(422, DHL_BODIES[body]);
    expect(result.code).toBe(code);
    expect(result.matches[0]?.id).toBe(id);
  });

  it('links the response to the request that caused it', () => {
    const request = shipmentRequest({ ...JSON.parse(shipmentRequest().body ?? '{}'), plannedShippingDateAndTime: '2026-10-27T02:00:00Z' });
    const result = top(400, DHL_BODIES.mydhlDate, request);
    expect(result.matches[0]?.id).toBe('mydhl.998-date');
    expect(result.requestFindings.map((f) => f.ruleId)).toContain('mydhl.date-format');
  });
});

it('recognises the legacy XML-PI "Site Id is wrong" text', () => {
  expect(top(200, DHL_BODIES.legacySiteId).matches[0]?.id).toBe('legacy.site-id');
});

it('returns no matches for an unrelated error', () => {
  expect(top(500, '{"error":"boom"}').matches).toEqual([]);
});

describe('API scoping', () => {
  it('does not give Tracking advice for a MyDHL 429 or 401', () => {
    expect(top(429, DHL_BODIES.trackingQuota, shipmentRequest()).matches).toEqual([]);
    expect(top(401, DHL_BODIES.trackingNoKey, shipmentRequest()).matches).toEqual([]);
  });

  it('explains a Parcel DE 401 in Parcel DE terms', () => {
    const request = { method: 'POST', url: 'https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders', body: '{}' };
    expect(top(401, DHL_BODIES.parcelDe401, request).matches.map((m) => m.id)).toEqual(['parcel-de.401']);
  });
});

describe('the catalogue itself', () => {
  it('has unique ids', () => {
    const ids = CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites an https source, a cause and a fix for every entry', () => {
    for (const entry of CATALOGUE) {
      expect(entry.sources.length, entry.id).toBeGreaterThan(0);
      expect(entry.sources.every((s) => s.url.startsWith('https://')), entry.id).toBe(true);
      expect(entry.causes.length, entry.id).toBeGreaterThan(0);
      expect(entry.fixes.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('can match every entry by something more than "any API"', () => {
    for (const entry of CATALOGUE) {
      expect(entry.code ?? entry.pattern ?? entry.status, entry.id).toBeDefined();
    }
  });
});
