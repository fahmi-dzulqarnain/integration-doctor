import type { DhlApi, Detection, Environment } from './types.js';

/**
 * Every operation in each API's OpenAPI specification, relative to its server URL:
 * MyDHL API 3.4.0, Shipment Tracking – Unified 1.5.8, Location Finder 1.14.0, Parcel DE Shipping 2.2.0.
 */
const ENDPOINTS: Record<Exclude<DhlApi, 'legacy-express' | 'unknown'>, readonly string[]> = {
  tracking: ['GET /shipments'],
  'location-finder': [
    'GET /find-by-address', 'GET /find-by-geo', 'GET /find-by-keyword-id', 'GET /locations/{locationId}',
  ],
  mydhl: [
    'POST /pickups', 'PATCH /pickups/{dispatchConfirmationNumber}', 'DELETE /pickups/{dispatchConfirmationNumber}',
    'GET /identifiers', 'GET /address-validate', 'GET /rates', 'POST /rates', 'POST /landed-cost', 'GET /products',
    'GET /shipments/{shipmentTrackingNumber}/tracking', 'GET /tracking',
    'GET /shipments/{shipmentTrackingNumber}/proof-of-delivery', 'PATCH /shipments/{shipmentTrackingNumber}/upload-image',
    'POST /shipments', 'PATCH /shipments/{shipmentTrackingNumber}/upload-invoice-data', 'POST /invoices/upload-invoice-data',
    'GET /shipments/{shipmentTrackingNumber}/get-image', 'PATCH /shipments/{shipmentTrackingNumber}/add-piece',
    'GET /servicepoints', 'GET /reference-data', 'POST /early-shipment-screening',
  ],
  'parcel-de-shipping': [
    'GET /', 'GET /labels', 'GET /manifests', 'POST /manifests', 'POST /customs-documents',
    'GET /orders', 'POST /orders', 'DELETE /orders',
  ],
};

/** Hosts and base paths from each specification's `servers` list. */
const ROUTES: readonly { host: string; base: string; api: keyof typeof ENDPOINTS; environment: Environment }[] = [
  { host: 'api-eu.dhl.com', base: '/track', api: 'tracking', environment: 'production' },
  { host: 'api-sandbox.dhl.com', base: '/track', api: 'tracking', environment: 'sandbox' },
  { host: 'api.dhl.com', base: '/location-finder/v1', api: 'location-finder', environment: 'production' },
  { host: 'express.api.dhl.com', base: '/mydhlapi/test', api: 'mydhl', environment: 'test' },
  { host: 'express.api.dhl.com', base: '/mydhlapi', api: 'mydhl', environment: 'production' },
  { host: 'api-mock.dhl.com', base: '/mydhlapi', api: 'mydhl', environment: 'mock' },
  { host: 'api-sandbox.dhl.com', base: '/parcel/de/shipping/v2', api: 'parcel-de-shipping', environment: 'sandbox' },
  { host: 'api-eu.dhl.com', base: '/parcel/de/shipping/v2', api: 'parcel-de-shipping', environment: 'production' },
];

/** The retired DHL Express SOAP/REST and XML-PI hosts that MyDHL API replaced. */
const LEGACY_EXPRESS_HOST = /^(wsbexpress\.dhl\.com|xmlpi(test)?-ea\.dhl\.com)$/;

/** `example.com.` and `EXAMPLE.com` are the same host. */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function decodedPath(url: URL): string {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape: match on the raw path.
  }
  return path.replace(/\/+$/, '') || '/';
}

function templateMatches(template: string, path: string): boolean {
  const pattern = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(path);
}

export function detect(method: string | undefined, url: URL | undefined): Detection {
  if (!url) return { api: 'unknown', environment: 'unknown' };
  const host = hostOf(url);
  if (LEGACY_EXPRESS_HOST.test(host)) return { api: 'legacy-express', environment: 'unknown' };

  const verb = (method ?? '').trim().toUpperCase();
  const path = decodedPath(url);
  for (const route of ROUTES) {
    if (host !== route.host) continue;
    if (path !== route.base && !path.startsWith(route.base + '/')) continue;
    const rest = path.slice(route.base.length) || '/';
    const endpoints = ENDPOINTS[route.api];
    const exact = endpoints.find((e) => e.startsWith(verb + ' ') && templateMatches(e.slice(verb.length + 1), rest));
    if (exact) {
      return { api: route.api, environment: route.environment, operation: exact, knownEndpoint: true };
    }
    const otherMethods = endpoints.filter((e) => templateMatches(e.slice(e.indexOf(' ') + 1), rest)).map((e) => e.split(' ')[0] ?? '');
    return {
      api: route.api,
      environment: route.environment,
      operation: `${verb} ${rest}`,
      knownEndpoint: false,
      ...(otherMethods.length > 0 && { allowedMethods: otherMethods }),
    };
  }
  return { api: 'unknown', environment: 'unknown' };
}

/** The endpoints DHL's specification lists for an API, for suggestions. */
export function endpointsOf(api: DhlApi): readonly string[] {
  return api === 'unknown' || api === 'legacy-express' ? [] : ENDPOINTS[api];
}
