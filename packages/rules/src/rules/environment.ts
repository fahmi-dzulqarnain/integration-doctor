import { endpointsOf, hostOf } from '../detect.js';
import { SOURCES } from '../sources.js';
import type { Finding, Source } from '../types.js';
import type { Rule } from './context.js';

/** Query parameter names that usually carry a credential. */
const SECRET_PARAM = /^(api[-_]?key|apikey|key|dhl-api-key|password|pass|secret|token|access[-_]?token)$/i;

const REFERENCES: Partial<Record<string, Source>> = {
  tracking: SOURCES.trackingReference,
  'location-finder': SOURCES.locationFinderReference,
  mydhl: SOURCES.mydhlReference,
  'parcel-de-shipping': SOURCES.parcelDeReference,
};

export const environmentRules: Rule[] = [
  ({ rawUrl, url }) => url ? [] : [{
    ruleId: 'url.invalid',
    severity: 'error',
    title: 'The URL cannot be parsed',
    detail: `"${rawUrl}" is not a complete URL.`,
    fix: 'Paste the full URL including the scheme, e.g. https://api-eu.dhl.com/track/shipments?trackingNumber=…',
    sources: [],
  }],

  ({ url, detection }) => url && url.protocol !== 'https:' && detection.api !== 'unknown' ? [{
    ruleId: 'url.not-https',
    severity: 'error',
    title: 'DHL APIs are HTTPS only',
    detail: `The request uses ${url.protocol.replace(':', '')}. Every server URL in DHL's specifications is https.`,
    fix: 'Use https://.',
    sources: [REFERENCES[detection.api] ?? SOURCES.trackingReference],
  }] : [],

  ({ detection }) => detection.api === 'legacy-express' ? [{
    ruleId: 'host.legacy-express',
    severity: 'error',
    title: 'This is the retired DHL Express endpoint',
    detail: 'wsbexpress and XML-PI hosts belong to the DHL Express APIs that MyDHL API replaced. Integrators report errors such as "The Shipper Account is invalid", "Process failure occurred" or "Site Id is wrong" there.',
    fix: 'Move to MyDHL API: https://express.api.dhl.com/mydhlapi/test for testing, https://express.api.dhl.com/mydhlapi for production, with the credentials your DHL Express contact issued.',
    sources: [SOURCES.mydhlReference, SOURCES.legacyEndpointIssue, SOURCES.siteIdIssue],
  }] : [],

  ({ url, detection }) => {
    if (!url || detection.api !== 'unknown') return [];
    const host = hostOf(url);
    if (host !== 'dhl.com' && !host.endsWith('.dhl.com')) return [];
    return [{
      ruleId: 'host.unknown-dhl',
      severity: 'warning',
      title: 'Not a DHL API host or path this tool knows',
      detail: `${host}${url.pathname} does not match Shipment Tracking, Location Finder, MyDHL API or Parcel DE Shipping. A wrong host or path prefix is one of the causes DHL lists for 401 responses.`,
      fix: 'Copy the server URL from the API reference: api-eu.dhl.com/track (Tracking), api.dhl.com/location-finder/v1, express.api.dhl.com/mydhlapi[/test], api-sandbox.dhl.com/parcel/de/shipping/v2.',
      sources: [SOURCES.tracking401],
    }];
  },

  ({ detection }) => {
    if (detection.knownEndpoint !== false || detection.operation === undefined) return [];
    const sources = [REFERENCES[detection.api] ?? SOURCES.trackingReference];
    if (detection.allowedMethods) {
      const path = detection.operation.slice(detection.operation.indexOf(' ') + 1);
      return [{
        ruleId: 'endpoint.method',
        severity: 'error',
        title: `${path} does not take ${detection.operation.split(' ')[0] ?? ''}`,
        detail: `DHL's specification defines ${detection.allowedMethods.join(', ')} for this path.`,
        fix: `Use ${detection.allowedMethods.join(' or ')}.`,
        sources,
      }];
    }
    const endpoints = endpointsOf(detection.api);
    return [{
      ruleId: 'endpoint.unknown',
      severity: 'error',
      title: `No ${detection.operation} in this API`,
      detail: `DHL's specification has no such endpoint${detection.environment === 'mock' ? ' (the mock server has no /test prefix)' : ''}. A wrong path is one of the causes DHL lists for 401 and 404 responses.`,
      fix: endpoints.length <= 8
        ? `Endpoints: ${endpoints.join(', ')}.`
        : `Check the path against the API reference, e.g. ${endpoints.slice(0, 4).join(', ')}.`,
      sources: [...sources, SOURCES.tracking401],
    }];
  },

  ({ detection }) => {
    switch (detection.environment) {
      case 'mock':
        return [info('env.mydhl-mock', 'MyDHL mock server', 'DHL\'s specification describes api-mock.dhl.com as simulating responses with fixed test data, not your account. Results say nothing about whether your credentials work.', 'Switch to express.api.dhl.com/mydhlapi/test once DHL has issued your credentials.', [SOURCES.mydhlReference])];
      case 'test':
        return [info('env.mydhl-test', 'MyDHL test environment', 'Test credentials only work here, and production credentials only on the production URL. DHL\'s portal lists a quota of 500 calls a day for the test environment.', 'Use the matching credentials; switch the URL, not just the credentials, when you go live.', [SOURCES.mydhlReference])];
      default:
        return [];
    }
  },

  ({ url, detection }) => {
    if (!url) return [];
    // Parcel DE's GET /labels is fetched with a download token DHL itself puts in the URL.
    const labelToken = detection.api === 'parcel-de-shipping' && detection.operation === 'GET /labels';
    const leaked = [...url.searchParams.keys()].filter((name) => SECRET_PARAM.test(name) && !(labelToken && name === 'token'));
    return leaked.map((name): Finding => ({
      ruleId: 'url.secret-in-query',
      severity: 'warning',
      title: 'A credential is in the URL',
      detail: `The query parameter "${name}" looks like a key or password. URLs end up in server logs, proxies and browser history, and DHL's APIs take credentials in headers.`,
      fix: 'Send the key in its header instead (DHL-API-Key for Tracking and Location Finder, Authorization for MyDHL), and rotate it if this URL was shared.',
      sources: [SOURCES.tracking401],
    }));
  },
];

function info(ruleId: string, title: string, detail: string, fix: string, sources: Finding['sources']): Finding {
  return { ruleId, severity: 'info', title, detail, fix, sources };
}
