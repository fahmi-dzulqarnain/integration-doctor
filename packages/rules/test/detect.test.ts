import { describe, expect, it } from 'vitest';
import { detect } from '../src/index.js';

const at = (method: string, url: string) => detect(method, new URL(url));

describe('detect', () => {
  it.each([
    ['GET', 'https://api-eu.dhl.com/track/shipments?trackingNumber=1', 'tracking', 'production', 'GET /shipments'],
    ['GET', 'https://api-sandbox.dhl.com/track/shipments', 'tracking', 'sandbox', 'GET /shipments'],
    ['GET', 'https://api.dhl.com/location-finder/v1/find-by-address', 'location-finder', 'production', 'GET /find-by-address'],
    ['POST', 'https://express.api.dhl.com/mydhlapi/test/shipments', 'mydhl', 'test', 'POST /shipments'],
    ['GET', 'https://express.api.dhl.com/mydhlapi/shipments/1234567890/tracking', 'mydhl', 'production', 'GET /shipments/{shipmentTrackingNumber}/tracking'],
    ['POST', 'https://api-mock.dhl.com/mydhlapi/shipments', 'mydhl', 'mock', 'POST /shipments'],
    ['POST', 'https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders', 'parcel-de-shipping', 'sandbox', 'POST /orders'],
    ['GET', 'https://api-sandbox.dhl.com/parcel/de/shipping/v2/', 'parcel-de-shipping', 'sandbox', 'GET /'],
  ])('%s %s is %s (%s)', (method, url, api, environment, operation) => {
    expect(at(method, url)).toEqual({ api, environment, operation, knownEndpoint: true });
  });

  it('recognises the retired DHL Express hosts', () => {
    expect(at('POST', 'https://wsbexpress.dhl.com/rest/sndpt/ShipmentRequest').api).toBe('legacy-express');
    expect(at('POST', 'https://xmlpitest-ea.dhl.com/XMLShippingServlet').api).toBe('legacy-express');
  });

  it('does not take a lookalike prefix for an API', () => {
    expect(at('GET', 'https://api-eu.dhl.com/tracking/shipments').api).toBe('unknown');
    expect(at('GET', 'https://evil.example.com/track/shipments').api).toBe('unknown');
  });

  it('keeps /mydhlapi/testing apart from the test environment, and marks it unknown', () => {
    expect(at('POST', 'https://express.api.dhl.com/mydhlapi/testing/shipments')).toMatchObject({ environment: 'production', knownEndpoint: false });
  });

  it('does not treat a sub-resource as POST /shipments', () => {
    expect(at('POST', 'https://express.api.dhl.com/mydhlapi/test/shipments/123/tracking')).toMatchObject({ knownEndpoint: false, allowedMethods: ['GET'] });
  });

  it('marks paths the specification does not list as unknown', () => {
    expect(at('POST', 'https://api-mock.dhl.com/mydhlapi/test/shipments').knownEndpoint).toBe(false);
    expect(at('GET', 'https://api.dhl.com/location-finder/v2/find-by-address').api).toBe('unknown');
  });

  it('normalises host case, a trailing dot and encoded paths', () => {
    expect(at('GET', 'https://API-EU.DHL.COM./track/%73hipments').operation).toBe('GET /shipments');
  });

  it('is unknown without a URL', () => {
    expect(detect('GET', undefined)).toEqual({ api: 'unknown', environment: 'unknown' });
  });
});
